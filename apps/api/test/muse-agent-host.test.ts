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
