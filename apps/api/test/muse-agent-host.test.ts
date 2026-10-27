import test from 'node:test';
import assert from 'node:assert/strict';
import {issueApprovalToken} from '@gift-signal/zero-trust';
import {AuthenticatedMuseCommerceHost,parseMuseAgentRequest} from '../dist/muse-agent-host.js';

const expiresAt='2099-01-01T00:00:00Z';
const draftHash='a'.repeat(64);
function token(overrides:any={}){return issueApprovalToken({subjectId:'buyer',companyId:'company',connectionId:'connection',draftId:'draft',
  draftHash,amount:58,currency:'USD',paymentAuthorizationReference:'seti_owned',expiresAt,...overrides},'approval-secret');}
function fixture(approvalToken?:string){
  const calls={submits:[] as any[],drafts:0};
  let transaction:any=null;let saved:any={reference:'seti_owned',customerId:'cus_owned',paymentMethodId:'pm_owned',usage:'off_session'};
  let ready=true;
  const deps:any={
    authority:{resolve:async()=>({subjectId:'buyer',companyId:'company',connectionId:'connection'})},
    drafts:{verifyForExecution:async()=>{calls.drafts++;return {draft:{draftId:'draft',total:58,currency:'USD',expiresAt},draftHash,state:{
      description:'Headphones',payment:{provider:'stripe',externalAccountId:'acct_private'},
      pricing:{lines:[{variantId:'variant',quantity:1,unitPrice:'50.00',title:'Headphones'}]},
      fulfillment:{externalAccountId:'seller.myshopify.com',shippingAddress:{address1:'123 Example',city:'Example',countryCode:'US',zip:'12345'},
        landedQuote:{shipping:{title:'Delivery',handle:'standard',amount:'3.00'},subtotal:'50.00',tax:'5.00',total:'58.00',currency:'USD'}}
    }};}},
    identities:{resolveStripeSavedPayment:async()=>saved},
    transactions:{getForConsumer:async(subject:string)=>transaction?.consumerSubjectId===subject?transaction:null,get:async()=>transaction},
    businessReady:async()=>ready,
    resolveSellerDisplayName:async()=>'Demo Seller',
    submit:async(args:any)=>{calls.submits.push(args);transaction={companyId:'company',consumerSubjectId:'buyer',draftId:'draft',state:'CHECKOUT_CREATED'};return {handoff:{required:false}};},
    approvalSecret:'approval-secret'
  };
  const host=new AuthenticatedMuseCommerceHost({subjectId:'buyer',email:'verified@example.com'},
    {connectionId:'connection',draftId:'draft',message:'Buy now',...(approvalToken?{approvalToken}:{})},deps);
  return {host,deps,calls,set transaction(value:any){transaction=value;},set saved(value:any){saved=value;},set ready(value:boolean){ready=value;}};
}
test('request accepts opaque transaction proof but rejects browser-selected identity and credentials',()=>{
  const body={connectionId:'connection',draftId:'draft',message:'Shop this reel'};
  assert.deepEqual(parseMuseAgentRequest(body),body);
  for(const key of ['subjectId','companyId','email','customerId','paymentMethodId','approved','context','configuration','baseUrl']){
    assert.throws(()=>parseMuseAgentRequest({...body,[key]:'attacker'}),/invalid_muse_agent_request/);
  }
});
test('ordinary Buy text does not create approval or authorize payment',async()=>{
  const f=fixture();const context=await f.host.readContext();
  assert.equal(context.approval,undefined);
  await assert.rejects(f.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),/not_authorized/);
  assert.equal(f.calls.submits.length,0);
  await f.host.dispatch({action:'present_review',args:{draftId:'draft'}});
  const event=f.host.events[0];assert.equal(event.total,'58.00');assert.equal(event.requiresBuy,true);
  // No terms, payment timing, or fulfillment estimate in this draft
  // state, so the review must say so — never invent a date or term.
  assert.equal(event.terms,'not available');
  assert.equal(event.paymentTiming,'not available');
  assert.equal(event.estimatedArrival,'not available');
  assert.equal(event.paymentLabel,'Saved payment');
  assert.equal(event.seller,'Demo Seller');
  assert.equal(event.items[0].title,'Headphones');
  assert.doesNotMatch(JSON.stringify(event),/seller\.myshopify\.com|variant/);
  assert.doesNotMatch(JSON.stringify(event),/acct_private|cus_owned|pm_owned|seti_owned|approval-secret/);
});
test('valid exact proof dispatches with authenticated subject and verified email only',async()=>{
  const proof=token();const f=fixture(proof);
  assert.equal((await f.host.readContext()).approval?.verified,true);
  assert.deepEqual(await f.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),{status:'payment_processing'});
  assert.deepEqual(f.calls.submits,[{subjectId:'buyer',consumerEmail:'verified@example.com',connectionId:'connection',draftId:'draft',approvalToken:proof}]);
  await assert.rejects(f.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),/not_authorized/);
  assert.equal(f.calls.submits.length,1);
});
for(const overrides of [{subjectId:'other'},{companyId:'other'},{draftHash:'b'.repeat(64)},{paymentAuthorizationReference:'seti_other'},{amount:1},{expiresAt:'2000-01-01T00:00:00Z'}]){
  test('mismatched or stale Buy proof cannot dispatch: '+Object.keys(overrides)[0],async()=>{
    const f=fixture(token(overrides));assert.equal((await f.host.readContext()).approval?.verified,false);
    await assert.rejects(f.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}));
    assert.equal(f.calls.submits.length,0);
  });
}
test('foreign connection or transaction ownership is rejected before revealing draft data',async()=>{
  const f=fixture();f.deps.authority.resolve=async()=>({subjectId:'attacker',companyId:'company'});
  await assert.rejects(f.host.readContext(),/consumer_agent_not_found/);assert.equal(f.calls.drafts,0);
  const other=fixture();other.transaction={consumerSubjectId:'attacker',companyId:'company',draftId:'draft',state:'ORDER_CREATED'};
  await assert.rejects(other.host.readContext(),/consumer_agent_not_found/);assert.equal(other.calls.drafts,0);
});
test('enrollment and autonomous business readiness are read from server services',async()=>{
  const f=fixture(token());f.saved=null;
  assert.equal((await f.host.readContext()).consumerEnrolled,false);
  await assert.rejects(f.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}));
  const b=fixture(token());b.ready=false;
  assert.equal((await b.host.readContext()).businessReady,false);
  await assert.rejects(b.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}));
});
test('tracking remains buyer-owned after approval expiry and unsafe tracking URLs are removed',async()=>{
  const f=fixture();f.transaction={consumerSubjectId:'buyer',companyId:'company',draftId:'draft',state:'ORDER_CREATED'};
  f.deps.drafts.verifyForExecution=async()=>{throw Error('old_review_expired');};
  f.deps.readTracking=async()=>[{url:'https://carrier.example/track',company:'Carrier'},{url:'javascript:alert(1)'},{url:'https://user:password@carrier.example/track'}];
  assert.equal((await f.host.readContext()).execution?.trackingStatus,'AVAILABLE');
  assert.deepEqual(await f.host.dispatch({action:'complete',args:{draftId:'draft'}}),{status:'tracking_available'});
  assert.deepEqual(f.host.events[0].tracking,[{url:'https://carrier.example/track',company:'Carrier'}]);
});
test('only trusted Stripe fallback is returned to the consumer, without exposing proof',async()=>{
  const f=fixture(token());f.deps.submit=async()=>{f.transaction={consumerSubjectId:'buyer',companyId:'company',draftId:'draft',state:'CHECKOUT_CREATED'};
    return {handoff:{required:true},checkoutUrl:'https://checkout.stripe.com/c/pay/session'};};
  await f.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}});
  assert.equal((await f.host.readContext()).execution?.state,'AUTHENTICATION_REQUIRED');
  assert.equal(f.host.events[0].url,'https://checkout.stripe.com/c/pay/session');
  const bad=fixture(token());bad.deps.submit=async()=>({handoff:{required:true},checkoutUrl:'https://merchant.example/checkout'});
  await assert.rejects(bad.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),/untrusted/);
  assert.deepEqual(bad.host.events,[]);
});

test('a new host resumes owned stored authentication without Buy proof or payment retry',async()=>{
  const f=fixture();f.transaction={consumerSubjectId:'buyer',companyId:'company',draftId:'draft',state:'CHECKOUT_CREATED',paymentReferenceKind:'checkout_session',paymentReference:'cs_test_existing'};
  let lookups=0;
  f.deps.readPaymentAuthentication=async(transaction:any)=>{lookups++;assert.equal(transaction.paymentReference,'cs_test_existing');
    return {status:'open',checkoutUrl:'https://checkout.stripe.com/c/pay/existing'};};
  assert.equal((await f.host.readContext()).execution?.state,'AUTHENTICATION_REQUIRED');
  assert.deepEqual(await f.host.dispatch({action:'open_payment_authentication',args:{draftId:'draft'}}),{status:'payment_authentication_required'});
  assert.equal(f.host.events[0].url,'https://checkout.stripe.com/c/pay/existing');assert.equal(f.calls.submits.length,0);assert.ok(lookups>=2);
});

test('paid or expired Checkout never offers another payment or creates a new session',async()=>{
  for(const status of ['complete','expired']){
    const f=fixture();f.transaction={consumerSubjectId:'buyer',companyId:'company',draftId:'draft',state:'CHECKOUT_CREATED',paymentReferenceKind:'checkout_session',paymentReference:'cs_test_existing'};
    f.deps.readPaymentAuthentication=async()=>({status});
    assert.equal((await f.host.readContext()).execution?.state,'IN_PROGRESS');
    await assert.rejects(f.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}));
    assert.equal(f.calls.submits.length,0);assert.equal(f.host.events.some(event=>event.type==='payment_authentication'),false);
    if(status==='expired') assert.equal(f.host.events[0].next,'NEW_REVIEW_REQUIRED');
  }
});

test('present_review uses a signed draft display name and title when no manifest resolver is available',async()=>{
  const f=fixture();
  f.deps.resolveSellerDisplayName=async()=>null;
  f.deps.drafts.verifyForExecution=async()=>({draft:{draftId:'draft',total:58,currency:'USD',expiresAt},draftHash,state:{
    description:'Headphones',payment:{provider:'stripe',externalAccountId:'acct_private'},
    pricing:{lines:[{variantId:'variant',quantity:1,unitPrice:'50.00',title:'Headphones'}]},
    fulfillment:{externalAccountId:'seller.myshopify.com',sellerDisplayName:'Signed Demo Seller',
      shippingAddress:{address1:'123 Example',city:'Example',countryCode:'US',zip:'12345'},
      landedQuote:{shipping:{title:'Delivery',handle:'standard',amount:'3.00'},subtotal:'50.00',tax:'5.00',total:'58.00',currency:'USD'}}
  }});
  await f.host.dispatch({action:'present_review',args:{draftId:'draft'}});
  const event=f.host.events[0];
  assert.equal(event.seller,'Signed Demo Seller');
  assert.equal(event.items[0].title,'Headphones');
  assert.doesNotMatch(JSON.stringify(event),/seller\.myshopify\.com|acct_private/);
});

test('present_review surfaces supplied terms, payment timing, and estimated arrival, and never a raw ID',async()=>{
  const f=fixture();
  f.deps.drafts.verifyForExecution=async()=>({draft:{draftId:'draft',total:58,currency:'USD',expiresAt},draftHash,state:{
    description:'Headphones',payment:{provider:'stripe',externalAccountId:'acct_private'},
    pricing:{lines:[{variantId:'variant',quantity:1,unitPrice:'50.00',title:'Headphones'}]},
    terms:'Returns within 30 days of delivery.',
    paymentTiming:'Charged when you approve this exact transaction.',
    estimatedArrival:'October 28, 2026',
    fulfillment:{externalAccountId:'seller.myshopify.com',sellerDisplayName:'Signed Demo Seller',
      shippingAddress:{address1:'123 Example',city:'Example',countryCode:'US',zip:'12345'},
      landedQuote:{shipping:{title:'Delivery',handle:'standard',amount:'3.00'},subtotal:'50.00',tax:'5.00',total:'58.00',currency:'USD'}}
  }});
  await f.host.dispatch({action:'present_review',args:{draftId:'draft'}});
  const event=f.host.events[0];
  assert.equal(event.terms,'Returns within 30 days of delivery.');
  assert.equal(event.paymentTiming,'Charged when you approve this exact transaction.');
  assert.equal(event.estimatedArrival,'October 28, 2026');
  assert.doesNotMatch(JSON.stringify(event),/seller\.myshopify\.com|acct_private/);
});

test('present_review fails closed when neither signed draft state nor a manifest resolver supplies a display name',async()=>{
  const f=fixture();
  f.deps.resolveSellerDisplayName=async()=>null;
  // Fixture state has no sellerDisplayName, so the host must not fall back to the shop domain.
  await assert.rejects(f.host.dispatch({action:'present_review',args:{draftId:'draft'}}),/muse_review_seller_display_required/);
});
// --- Generic execution profile: Muse host submit routing ---
// The generic path never touches the reference (Stripe/Shopify) draft
// service, business-ready check, or submit function: those stubs throw if
// called, so any accidental reference-path use fails the test loudly.
function genericToken(overrides:any={}){return issueApprovalToken({subjectId:'buyer',companyId:'generic-co',connectionId:'connection',draftId:'draft',
  draftHash,amount:120,currency:'USD',expiresAt,...overrides},'approval-secret');}
function genericFixture(approvalToken?:string){
  const calls={genericSubmits:[] as any[],referenceSubmits:0};
  let transaction:any=null;let ready=true;let profile='generic';
  let genericResult:any={status:'CONFIRMED',executionId:'synthetic-exec-1',providerReference:'SYNTHETIC-DEMO-ONLY-1'};
  let genericError:any=null;
  const deps:any={
    authority:{resolve:async()=>({subjectId:'buyer',companyId:'generic-co',connectionId:'connection'})},
    drafts:{verifyForExecution:async()=>{throw Error('must_not_use_reference_draft');}},
    identities:{resolveStripeSavedPayment:async()=>null},
    transactions:{getForConsumer:async()=>transaction,get:async()=>transaction},
    businessReady:async()=>{throw Error('must_not_use_reference_business_ready');},
    submit:async()=>{calls.referenceSubmits++;throw Error('must_not_use_reference_submit');},
    resolveExecutionProfile:async()=>profile,
    genericReadiness:async()=>ready,
    submitGeneric:async(args:any)=>{calls.genericSubmits.push(args);if(genericError) throw genericError;return genericResult;},
    genericDraft:async()=>({draftHash,total:120,currency:'USD',expiresAt}),
    approvalSecret:'approval-secret'
  };
  const host=new AuthenticatedMuseCommerceHost({subjectId:'buyer',email:'verified@example.com'},
    {connectionId:'connection',draftId:'draft',message:'Buy now',...(approvalToken?{approvalToken}:{})},deps);
  return {host,deps,calls,
    set transaction(value:any){transaction=value;},
    set ready(value:boolean){ready=value;},
    set profile(value:string){profile=value;},
    set genericResult(value:any){genericResult=value;},
    set genericError(value:any){genericError=value;}};
}

test('generic profile routes Muse submit to the rail-independent executor, never the reference submit',async()=>{
  const proof=genericToken();const f=genericFixture(proof);
  assert.deepEqual(await f.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),{status:'payment_processing'});
  assert.deepEqual(f.calls.genericSubmits,[{subjectId:'buyer',consumerEmail:'verified@example.com',companyId:'generic-co',connectionId:'connection',draftId:'draft',approvalToken:proof}]);
  assert.equal(f.calls.referenceSubmits,0);
});

test('generic profile without a configured generic submitter fails closed',async()=>{
  const f=genericFixture(genericToken());delete f.deps.submitGeneric;
  await assert.rejects(f.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),/muse_generic_submit_not_configured/);
  assert.equal(f.calls.genericSubmits.length,0);
});

test('generic per-company readiness gate blocks submit when the company is not ready',async()=>{
  const f=genericFixture(genericToken());f.ready=false;
  await assert.rejects(f.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),/muse_generic_business_not_ready/);
  assert.equal(f.calls.genericSubmits.length,0);
});

test('generic drift error surfaces for reapproval and is never retried by the host',async()=>{
  const f=genericFixture(genericToken());f.genericError=Error('provider_state_changed_reapproval_required');
  await assert.rejects(f.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),/provider_state_changed_reapproval_required/);
  assert.equal(f.calls.genericSubmits.length,1);
});

test('generic replayed approval is rejected and the token is passed through unchanged',async()=>{
  const proof=genericToken();const f=genericFixture(proof);
  let attempts=0;
  f.deps.submitGeneric=async(args:any)=>{attempts++;assert.equal(args.approvalToken,proof);if(attempts>1) throw Error('approval_replayed');return {status:'CONFIRMED'};};
  assert.deepEqual(await f.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),{status:'payment_processing'});
  const second=new AuthenticatedMuseCommerceHost({subjectId:'buyer',email:'verified@example.com'},
    {connectionId:'connection',draftId:'draft',message:'Buy now',approvalToken:proof},f.deps);
  await assert.rejects(second.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),/approval_replayed/);
  assert.equal(attempts,2);
});

test('generic duplicate execute after a recorded transaction commits nothing',async()=>{
  const f=genericFixture(genericToken());
  f.transaction={companyId:'generic-co',consumerSubjectId:'buyer',draftId:'draft',state:'ORDER_CREATED'};
  await assert.rejects(f.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),/muse_generic_execution_already_recorded/);
  assert.equal(f.calls.genericSubmits.length,0);
});

test('generic cross-company submit forwards only the owned connection company and is rejected on scope mismatch',async()=>{
  const seen:any[]=[];
  const deps:any={
    authority:{resolve:async()=>({subjectId:'buyer',companyId:'other-co',connectionId:'connection'})},
    drafts:{verifyForExecution:async()=>{throw Error('must_not_use_reference_draft');}},
    identities:{resolveStripeSavedPayment:async()=>null},
    transactions:{getForConsumer:async()=>null,get:async()=>null},
    businessReady:async()=>{throw Error('must_not_use_reference_business_ready');},
    submit:async()=>{throw Error('must_not_use_reference_submit');},
    resolveExecutionProfile:async()=>'generic',
    genericReadiness:async()=>true,
    submitGeneric:async(args:any)=>{seen.push(args);throw Error('draft_scope_mismatch');},
    approvalSecret:'approval-secret'};
  const host=new AuthenticatedMuseCommerceHost({subjectId:'buyer'},
    {connectionId:'connection',draftId:'draft',message:'Buy now',approvalToken:genericToken()},deps);
  await assert.rejects(host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),/draft_scope_mismatch/);
  assert.equal(seen.length,1);
  assert.equal(seen[0].companyId,'other-co');
});

test('generic cancelled connection and expired draft commit nothing',async()=>{
  const cancelled=genericFixture(genericToken());
  cancelled.deps.authority.resolve=async()=>null;
  await assert.rejects(cancelled.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),/consumer_agent_not_found/);
  assert.equal(cancelled.calls.genericSubmits.length,0);
  const expired=genericFixture(genericToken());expired.genericError=Error('draft_expired');
  await assert.rejects(expired.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),/draft_expired/);
  assert.equal(expired.calls.genericSubmits.length,1);
});

test('generic uncertain completion goes to reconciliation, never a retry',async()=>{
  const returned=genericFixture(genericToken());
  returned.genericResult={status:'UNCERTAIN',executionId:'synthetic-exec-9'};
  assert.deepEqual(await returned.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),{status:'reconciliation_required'});
  assert.equal(returned.host.events[0].type,'reconciliation_required');
  assert.equal(returned.calls.genericSubmits.length,1);
  const thrown=genericFixture(genericToken());thrown.genericError=Error('execution_uncertain_reconciliation_required');
  assert.deepEqual(await thrown.host.dispatch({action:'execute_approved_purchase',args:{draftId:'draft'}}),{status:'reconciliation_required'});
  assert.equal(thrown.host.events[0].type,'reconciliation_required');
  assert.equal(thrown.calls.genericSubmits.length,1);
});

test('generic readContext uses the owned connection and rail-independent approval, never a Stripe saved payment',async()=>{
  const f=genericFixture(genericToken());
  const context=await f.host.readContext();
  assert.equal(context.businessReady,true);
  assert.equal(context.consumerEnrolled,true);
  assert.equal(context.draft?.draftHash,draftHash);
  assert.equal(context.approval?.verified,true);
  assert.equal(context.draft?.paymentAuthorizationReference,'');
  const missing=genericFixture(genericToken());delete missing.deps.genericDraft;
  await assert.rejects(missing.host.readContext(),/muse_generic_draft_not_configured/);
});

test('generic execute with a mismatched step scope submits nothing',async()=>{
  const f=genericFixture(genericToken());
  await assert.rejects(f.host.dispatch({action:'execute_approved_purchase',args:{draftId:'other'}}),/muse_step_scope_mismatch/);
  assert.equal(f.calls.genericSubmits.length,0);
});

// --- Shop Pay vehicle: review label and readiness ---
test('Shop Pay review shows Shop Pay label, never a raw account ID, and is not business-ready without a vehicle flag',async()=>{
  const f=fixture();
  f.deps.drafts.verifyForExecution=async()=>({draft:{draftId:'draft',total:58,currency:'USD',expiresAt},draftHash,state:{
    description:'Headphones',paymentVehicle:'shop_pay',payment:{provider:'shop_pay',externalAccountId:'acct_private'},
    pricing:{lines:[{variantId:'variant',quantity:1,unitPrice:'50.00',title:'Headphones'}]},
    fulfillment:{externalAccountId:'seller.myshopify.com',sellerDisplayName:'Demo Seller',
      shippingAddress:{address1:'123 Example',city:'Example',countryCode:'US',zip:'12345'},
      landedQuote:{shipping:{title:'Delivery',handle:'standard',amount:'3.00'},subtotal:'50.00',tax:'5.00',total:'58.00',currency:'USD'}}
  }});
  f.deps.identities.resolveStripeSavedPayment=async()=>null;
  f.deps.identities.resolveShopPaySavedPayment=async()=>({reference:'shop-pay-ref'});
  const context=await f.host.readContext();
  assert.equal(context.businessReady,false);
  assert.equal(context.consumerEnrolled,true);
  // With no vehicle flag the validator routes to
  // request_business_connection, so no review is presented.
  await assert.rejects(f.host.dispatch({action:'present_review',args:{draftId:'draft'}}),/muse_step_not_authorized/);
});

test('Shop Pay review is business-ready only when the host business check and the vehicle flag both pass',async()=>{
  const f=fixture();
  f.deps.drafts.verifyForExecution=async()=>({draft:{draftId:'draft',total:58,currency:'USD',expiresAt},draftHash,state:{
    description:'Headphones',paymentVehicle:'shop_pay',payment:{provider:'shop_pay',externalAccountId:'acct_private'},
    pricing:{lines:[{variantId:'variant',quantity:1,unitPrice:'50.00',title:'Headphones'}]},
    fulfillment:{externalAccountId:'seller.myshopify.com',sellerDisplayName:'Demo Seller',
      shippingAddress:{address1:'123 Example',city:'Example',countryCode:'US',zip:'12345'},
      landedQuote:{shipping:{title:'Delivery',handle:'standard',amount:'3.00'},subtotal:'50.00',tax:'5.00',total:'58.00',currency:'USD'}}
  }});
  f.deps.identities.resolveStripeSavedPayment=async()=>null;
  f.deps.identities.resolveShopPaySavedPayment=async()=>({reference:'shop-pay-ref'});
  f.deps.shopPayVehicleReady=async()=>true;
  assert.equal((await f.host.readContext()).businessReady,true);
  await f.host.dispatch({action:'present_review',args:{draftId:'draft'}});
  const event=f.host.events[0];
  assert.equal(event.paymentLabel,'Shop Pay · Saved payment');
  assert.doesNotMatch(JSON.stringify(event),/acct_private|shop-pay-ref/);
});

test('present_review prefers the persisted manifest name over the signed draft name',async()=>{
  const f=fixture();
  f.deps.resolveSellerDisplayName=async()=>'Persisted Seller';
  f.deps.drafts.verifyForExecution=async()=>({draft:{draftId:'draft',total:58,currency:'USD',expiresAt},draftHash,state:{
    description:'Headphones',payment:{provider:'stripe',externalAccountId:'acct_private'},
    pricing:{lines:[{variantId:'variant',quantity:1,unitPrice:'50.00',title:'Headphones'}]},
    fulfillment:{externalAccountId:'seller.myshopify.com',sellerDisplayName:'Signed Demo Seller',
      shippingAddress:{address1:'123 Example',city:'Example',countryCode:'US',zip:'12345'},
      landedQuote:{shipping:{title:'Delivery',handle:'standard',amount:'3.00'},subtotal:'50.00',tax:'5.00',total:'58.00',currency:'USD'}}
  }});
  await f.host.dispatch({action:'present_review',args:{draftId:'draft'}});
  const event=f.host.events[0];assert.equal(event.seller,'Persisted Seller');
  assert.doesNotMatch(JSON.stringify(event),/seller\.myshopify\.com|acct_private/);
});

// Generic profile registry (muse-generic-profile.ts): explicit
// registration only, never inferred, never the synthetic fixture.
// These tests use a local test-only adapter shape, not the
// synthetic fixture connector, which must never be registered
// for a real company.
import {MemoryCompanyGenericProfileStore,createGenericProfileResolver,createGenericReadiness,createGenericDraftResolver,createGenericSubmit,validateGenericProfileRegistration} from '../dist/muse-generic-profile.js';
import {signDraft} from '@gift-signal/zero-trust';

test('generic profile registration requires the principal company and real evidence, never a mismatch or placeholder',()=>{
  assert.equal(validateGenericProfileRegistration({companyId:'co-1',evidenceRef:'oauth-conn-9',registeredBy:'co-1',principalOrgId:'co-1'}).companyId,'co-1');
  assert.throws(()=>validateGenericProfileRegistration({companyId:'co-2',evidenceRef:'oauth-conn-9',registeredBy:'co-2',principalOrgId:'co-1'}),/generic_profile_company_mismatch/);
  assert.throws(()=>validateGenericProfileRegistration({companyId:'co-1',evidenceRef:'placeholder',registeredBy:'co-1',principalOrgId:'co-1'}),/generic_profile_evidence_ref_invalid/);
  assert.throws(()=>validateGenericProfileRegistration({companyId:'synthetic-fixture-demo-only',evidenceRef:'oauth-conn-9',registeredBy:'synthetic-fixture-demo-only',principalOrgId:'synthetic-fixture-demo-only'}),/synthetic_fixture_not_registerable/);
});

test('generic profile resolver returns generic only for a registered company, reference otherwise, and readiness matches',async()=>{
  const store=new MemoryCompanyGenericProfileStore();
  const resolve=createGenericProfileResolver(store);
  const ready=createGenericReadiness(store);
  assert.equal(await resolve({companyId:'co-1',connectionId:'c',draftId:'d'}),'reference');
  assert.equal(await ready('co-1'),false);
  await store.register({companyId:'co-1',evidenceRef:'oauth-conn-9',registeredBy:'co-1'});
  assert.equal(await resolve({companyId:'co-1',connectionId:'c',draftId:'d'}),'generic');
  assert.equal(await ready('co-1'),true);
  assert.equal(await resolve({companyId:'co-2',connectionId:'c',draftId:'d'}),'reference');
  await store.deactivate('co-1');
  assert.equal(await resolve({companyId:'co-1',connectionId:'c',draftId:'d'}),'reference');
});

test('generic draft resolver verifies the signed envelope and scope-checks company and connection',async()=>{
  const draft:any={draftId:'gd-1',companyId:'co-1',connectionId:'conn-1',kind:'BOOKING',offerIds:['offer-1'],quantity:1,total:120,currency:'USD',summary:'Test-only generic draft',createdAt:'2026-01-01T00:00:00Z',expiresAt,approvalRequired:true,liveRevalidationRequired:true};
  const envelope=signDraft(draft,'draft-secret');
  const drafts={get:async(id:string)=>id==='gd-1'?envelope:null};
  const resolve=createGenericDraftResolver(drafts,'draft-secret');
  const facts=await resolve({companyId:'co-1',connectionId:'conn-1',draftId:'gd-1'});
  assert.equal(facts?.draftHash,envelope.payloadHash);
  assert.equal(facts?.total,120);
  assert.equal(await resolve({companyId:'co-2',connectionId:'conn-1',draftId:'gd-1'}),null);
  assert.equal(await resolve({companyId:'co-1',connectionId:'conn-2',draftId:'gd-1'}),null);
  assert.equal(await createGenericDraftResolver(drafts,'wrong-secret')({companyId:'co-1',connectionId:'conn-1',draftId:'gd-1'}),null);
});

test('generic submit without a runtime fails closed without consuming anything, and with a runtime maps CONFIRMED/FAILED',async()=>{
  const submitNone=createGenericSubmit(null);
  await assert.rejects(submitNone({subjectId:'buyer',companyId:'co-1',connectionId:'c',draftId:'d',approvalToken:'tok'}),/muse_generic_connector_not_registered/);
  const runtime:any={execute:async()=>({status:'CONFIRMED',executionId:'exec-1',providerReference:'REF-1'})};
  const submit=createGenericSubmit(runtime);
  assert.deepEqual(await submit({subjectId:'buyer',companyId:'co-1',connectionId:'c',draftId:'d',approvalToken:'tok'}),{status:'CONFIRMED',executionId:'exec-1',providerReference:'REF-1'});
  runtime.execute=async()=>({status:'FAILED',executionId:'exec-2'});
  assert.deepEqual(await submit({subjectId:'buyer',companyId:'co-1',connectionId:'c',draftId:'d',approvalToken:'tok'}),{status:'FAILED',executionId:'exec-2'});
  runtime.execute=async()=>{throw new Error('unknown_company_connector');};
  await assert.rejects(submit({subjectId:'buyer',companyId:'co-1',connectionId:'c',draftId:'d',approvalToken:'tok'}),/muse_generic_connector_not_registered/);
});

import {buildGenericProfileNextSteps,createGenericSubmit} from '../dist/muse-generic-profile.js';
test('generic profile next steps order adapter/manifest/connection after registration, and adapter-config gate is distinct from adapter-not-registered',async()=>{
  const steps=buildGenericProfileNextSteps({profileRegistered:true,adapterConfigured:false,manifestPresent:false});
  assert.deepEqual(steps.map(s=>s.step),['profile','adapter','manifest','provider_connection_and_readiness']);
  assert.equal(steps[0].status,'done');
  assert.equal(steps[1].status,'pending');
  assert.match(steps[1].action,/MUSE_GENERIC_ADAPTER_CONFIG_JSON/);
  const done=buildGenericProfileNextSteps({profileRegistered:true,adapterConfigured:true,manifestPresent:true});
  assert.equal(done[1].status,'done');
  assert.equal(done[2].status,'done');
  // Adapter-config gate: company absent from config fails before the runtime is even called.
  let runtimeCalls=0;
  const submit=createGenericSubmit({execute:async()=>{runtimeCalls++;return {status:'CONFIRMED'} as any;}}, {'other-co':'adapter-1'});
  await assert.rejects(submit({subjectId:'buyer',companyId:'my-co',connectionId:'c',draftId:'d',approvalToken:'t'}),/muse_generic_adapter_not_configured/);
  assert.equal(runtimeCalls,0);
  // Company in config but no runtime adapter still fails closed, with the original error.
  const noRuntime=createGenericSubmit(null, {'my-co':'adapter-1'});
  await assert.rejects(noRuntime({subjectId:'buyer',companyId:'my-co',connectionId:'c',draftId:'d',approvalToken:'t'}),/muse_generic_connector_not_registered/);
});

// --- Abandoned-chat resume (production host path) ---
// These gates run in CI via this already-listed file. No live
// call, no real consumer, no approval, and no execution happen
// in any of them: resumeDraft() only decides, it never submits.
test('abandoned resume returns to an existing unapproved draft as present_review, with no submit', async () => {
  const f = fixture();
  const decision = await f.host.resumeDraft();
  assert.equal(decision.kind, 'present_review');
  if (decision.kind === 'present_review') {
    assert.equal(decision.draftId, 'draft');
    assert.equal(decision.approvalRequired, true);
    assert.equal(decision.approvalCarried, false);
    assert.equal(decision.executeAgain, false);
    assert.equal(decision.freshBuy, false);
  }
  assert.equal(f.calls.submits.length, 0);
});
test('abandoned resume with an expired draft requires reapproval, not a lost order or an error with no path', async () => {
  const f = fixture();
  f.deps.drafts.verifyForExecution = async () => { throw Error('draft_expired'); };
  const decision = await f.host.resumeDraft();
  assert.equal(decision.kind, 'reapproval_required');
  if (decision.kind === 'reapproval_required') {
    assert.equal(decision.requiresNewApproval, true);
    assert.equal(decision.approvalCarried, false);
  }
  assert.equal(f.calls.submits.length, 0);
});
test('abandoned resume with a changed draft requires reapproval and never carries the old review', async () => {
  const f = fixture();
  const decision = await f.host.resumeDraft({changedSinceReview: true});
  assert.equal(decision.kind, 'reapproval_required');
  if (decision.kind === 'reapproval_required') {
    assert.equal(decision.requiresNewApproval, true);
    assert.equal(decision.approvalCarried, false);
  }
});
test('abandoned resume after approval shows the execution state, never a fresh Buy or a second execution', async () => {
  for (const [state, expected] of [
    ['ORDER_CREATED', 'completed'],
    ['REFUNDED', 'completed'],
    ['RECONCILE_REQUIRED', 'reconciliation'],
    ['CHECKOUT_CREATED', 'processing'],
  ] as const) {
    const f = fixture();
    f.transaction = {consumerSubjectId: 'buyer', companyId: 'company', draftId: 'draft', state};
    const decision = await f.host.resumeDraft();
    assert.equal(decision.kind, 'execution_state');
    if (decision.kind === 'execution_state') {
      assert.equal(decision.executionState, expected);
      assert.equal(decision.executeAgain, false);
      assert.equal(decision.freshBuy, false);
    }
    assert.equal(f.calls.submits.length, 0);
  }
  // An open trusted Checkout session resumes as authentication required, not a new payment.
  const f = fixture();
  f.transaction = {consumerSubjectId: 'buyer', companyId: 'company', draftId: 'draft', state: 'CHECKOUT_CREATED', paymentReferenceKind: 'checkout_session', paymentReference: 'cs_test_existing'};
  f.deps.readPaymentAuthentication = async () => ({status: 'open', checkoutUrl: 'https://checkout.stripe.com/c/pay/existing'});
  const auth = await f.host.resumeDraft();
  assert.equal(auth.kind, 'execution_state');
  if (auth.kind === 'execution_state') assert.equal(auth.executionState, 'authentication_required');
  assert.equal(f.calls.submits.length, 0);
});
test('abandoned resume fails closed on foreign ownership and on tampered drafts', async () => {
  const f = fixture();
  f.transaction = {consumerSubjectId: 'attacker', companyId: 'company', draftId: 'draft', state: 'ORDER_CREATED'};
  await assert.rejects(f.host.resumeDraft(), /consumer_agent_not_found/);
  assert.equal(f.calls.drafts, 0);
  const tampered = fixture();
  tampered.deps.drafts.verifyForExecution = async () => { throw Error('tampered_draft'); };
  await assert.rejects(tampered.host.resumeDraft(), /tampered_draft/);
  assert.equal(tampered.calls.submits.length, 0);
});
