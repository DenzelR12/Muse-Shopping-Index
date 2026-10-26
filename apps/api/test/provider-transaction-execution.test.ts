import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderTransactionExecutionService} from '../dist/provider-transaction-execution.js';

const baseConnection={
  companyId:'org-a',
  provider:'stripe',
  externalAccountId:'acct-1',
  grantedCapabilities:['order.create'],
  createdAt:'2026-10-25T00:00:00Z',
  updatedAt:'2026-10-25T00:00:00Z'
};

function service(overrides:{
  connection?:any;
  policy?:any;
  inactive?:string[];
  events?:any[];
  approvalJti?:string;
  providerDraftOrderId?:string;
  stalePreparation?:boolean;
  recoveredDraftOrderId?:string;
  createDraftError?:string;
}={}){
  const events=overrides.events??[];
  const connections={async get(){return overrides.connection??baseConnection;}};
  const policies={async get(){return overrides.policy??{
    companyId:'org-a',provider:'stripe',externalAccountId:'acct-1',
    allowedAgents:['agent-1'],maxOrderAmount:500,currency:'USD',updatedAt:'2026-10-25T00:00:00Z'
  };}};
  const agents={async requireActive(){return overrides.inactive??[];}};
  const intents={
    approvalJti:overrides.approvalJti,
    providerDraftOrderId:overrides.providerDraftOrderId,
    state:'CHECKOUT_PENDING',
    pendingInput:null as any,
    async createPending(input:any){this.pendingInput=input;return {state:this.state,approvalJti:this.approvalJti,providerDraftOrderId:this.providerDraftOrderId,paymentReference:this.paymentReference,paymentReferenceKind:this.paymentReferenceKind};},
    async authorizePending(_companyId:string,_draftId:string,jti:string){this.approvalJti=jti;this.state='CHECKOUT_PENDING';return {state:this.state,approvalJti:jti,providerDraftOrderId:this.providerDraftOrderId};},
    async claimDraftPreparation(){
      if(this.providerDraftOrderId) return null;
      if(overrides.stalePreparation) return null;
      return {state:'DRAFT_PREPARING',approvalJti:this.approvalJti};
    },
    async reclaimStaleDraftPreparation(){
      return overrides.stalePreparation&&!this.providerDraftOrderId?{state:'DRAFT_PREPARING',approvalJti:this.approvalJti}:null;
    },
    async attachProviderDraftOrder(_companyId:string,_draftId:string,id:string){this.providerDraftOrderId=id;this.state='CHECKOUT_PENDING';return {state:this.state,approvalJti:this.approvalJti,providerDraftOrderId:id};},
    async restoreDraftPreparation(){restoreCalls++;return {state:'CHECKOUT_PENDING',approvalJti:this.approvalJti};},
    async get(){return {state:overrides.stalePreparation?'DRAFT_PREPARING':this.state,approvalJti:this.approvalJti,providerDraftOrderId:this.providerDraftOrderId,paymentReference:this.paymentReference,paymentReferenceKind:this.paymentReferenceKind};},
    paymentReference:undefined as string|undefined,
    paymentReferenceKind:undefined as 'checkout_session'|'payment_intent'|undefined,
    async attachPaymentReference(_companyId:string,_draftId:string,input:any){
      if(this.paymentReference&&this.paymentReference!==input.reference) return null;
      if(this.paymentReferenceKind&&this.paymentReferenceKind!==input.kind) return null;
      this.paymentReference=input.reference;
      this.paymentReferenceKind=input.kind;
      this.state='CHECKOUT_CREATED';
      return {state:this.state,approvalJti:this.approvalJti,providerDraftOrderId:this.providerDraftOrderId,paymentReference:this.paymentReference,paymentReferenceKind:this.paymentReferenceKind};
    },
    async markPaymentFallbackPending(_companyId:string,_draftId:string,id:string){
      if(this.paymentReference!==id||this.paymentReferenceKind!=='payment_intent') return null;
      this.state='PAYMENT_FALLBACK_PENDING';
      return {state:this.state,approvalJti:this.approvalJti,providerDraftOrderId:this.providerDraftOrderId,paymentReference:this.paymentReference,paymentReferenceKind:this.paymentReferenceKind};
    },
    async replacePaymentReference(_companyId:string,_draftId:string,input:any){
      if(this.paymentReference!==input.fromReference||this.paymentReferenceKind!==input.fromKind) return null;
      this.paymentReference=input.toReference;
      this.paymentReferenceKind=input.toKind;
      this.state='CHECKOUT_CREATED';
      return {state:this.state,approvalJti:this.approvalJti,providerDraftOrderId:this.providerDraftOrderId,paymentReference:this.paymentReference,paymentReferenceKind:this.paymentReferenceKind};
    },
    async attachCheckout(_companyId:string,_draftId:string,id:string){
      return this.attachPaymentReference(_companyId,_draftId,{reference:id,kind:'checkout_session'});
    }
  };
  let draftCreateCalls=0;
  let recoveryCalls=0;
  let restoreCalls=0;
  const runtimeControl={
    async findDraftOrder(){
      recoveryCalls++;
      return {result:overrides.recoveredDraftOrderId?{draftOrderId:overrides.recoveredDraftOrderId}:null};
    },
    async createDraftOrder(){
      draftCreateCalls++;
      if(overrides.createDraftError) throw new Error(overrides.createDraftError);
      return {result:{draftOrderId:'gid://shopify/DraftOrder/55'}};
    }
  };
  const auditor={async record(type:string,metadata:any){events.push({type,metadata});}};
  return {
    svc:new ProviderTransactionExecutionService(connections as any,policies as any,agents as any,intents as any,runtimeControl as any,auditor as any,'sk_test'),
    events,intents,
    get draftCreateCalls(){return draftCreateCalls;},
    get recoveryCalls(){return recoveryCalls;},
    get restoreCalls(){return restoreCalls;}
  };
}

const args={
  companyId:'org-a',provider:'stripe',externalAccountId:'acct-1',agentId:'agent-1',requestId:'req-1',
  draftId:'draft-1',amount:125.50,currency:'USD',description:'Gift order',
  successUrl:'https://example.test/success',cancelUrl:'https://example.test/cancel',
  fulfillment:{
    provider:'shopify' as const,
    externalAccountId:'example-shop.myshopify.com',
    lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}],
    shippingAddress:{address1:'123 Main St',city:'Atlanta',provinceCode:'GA',countryCode:'US',zip:'30303'},
    landedQuote:{currency:'USD',subtotal:'110.00',tax:'8.00',shipping:{handle:'ground',title:'Ground',amount:'7.50'},total:'125.50'}
  },
  approval:{jti:'approval-1',consume:async()=>true}
};

test('authorized provider checkout reaches Stripe only after policy checks',async()=>{
  const {svc,events,intents}=service();
  let calls=0;
  const result=await svc.createCheckout({...args,fetchImpl:async(_url,init)=>{
    calls++;
    assert.equal(String((init?.headers as any).authorization),'Bearer sk_test');
    return new Response(JSON.stringify({id:'cs_123',url:'https://checkout.stripe.com/c/pay/cs_123',status:'open'}),{status:200});
  }});
  assert.equal(calls,1);
  assert.equal(result.checkoutSessionId,'cs_123');
  assert.equal(intents.providerDraftOrderId,'gid://shopify/DraftOrder/55');
  assert.equal(events.length,1);
  assert.equal(events[0].type,'provider.transaction.checkout_created');
  assert.equal(events[0].metadata.agentId,'agent-1');
  assert.equal(events[0].metadata.amount,125.5);
  assert.deepEqual(intents.pendingInput.fulfillmentPayload.shippingAddress,args.fulfillment.shippingAddress);
  assert.deepEqual(intents.pendingInput.fulfillmentPayload.landedQuote,args.fulfillment.landedQuote);
});

test('inactive agent is rejected before external payment execution',async()=>{
  const {svc}=service({inactive:['agent-1']});
  let calls=0;
  await assert.rejects(
    svc.createCheckout({...args,fetchImpl:async()=>{calls++;throw new Error('should_not_call');}}),
    /provider_agent_not_authorized/
  );
  assert.equal(calls,0);
});

test('agent outside policy allowlist is rejected before Stripe',async()=>{
  const {svc}=service({policy:{
    companyId:'org-a',provider:'stripe',externalAccountId:'acct-1',
    allowedAgents:['agent-2'],maxOrderAmount:500,currency:'USD',updatedAt:'2026-10-25T00:00:00Z'
  }});
  let calls=0;
  await assert.rejects(
    svc.createCheckout({...args,fetchImpl:async()=>{calls++;throw new Error('should_not_call');}}),
    /provider_agent_not_allowed/
  );
  assert.equal(calls,0);
});

test('amount and currency policy violations are rejected before Stripe',async()=>{
  const {svc}=service();
  let calls=0;
  const never=async()=>{calls++;throw new Error('should_not_call');};
  await assert.rejects(svc.createCheckout({...args,amount:501,fetchImpl:never}),/provider_agent_policy_amount_exceeded/);
  await assert.rejects(svc.createCheckout({...args,currency:'EUR',fetchImpl:never}),/provider_agent_policy_currency_mismatch/);
  assert.equal(calls,0);
});


test('replayed approval cannot authorize a new pending transaction',async()=>{
  const {svc}=service();
  let stripeCalls=0;
  await assert.rejects(
    svc.createCheckout({
      ...args,
      approval:{jti:'approval-2',consume:async()=>false},
      fetchImpl:async()=>{stripeCalls++;throw new Error('should_not_call');}
    }),
    /approval_replayed/
  );
  assert.equal(stripeCalls,0);
});

test('retry with same persisted approval JTI does not consume approval twice',async()=>{
  const {svc}=service({approvalJti:'approval-1'});
  let consumeCalls=0;
  let stripeCalls=0;
  const result=await svc.createCheckout({
    ...args,
    approval:{jti:'approval-1',consume:async()=>{consumeCalls++;return false;}},
    fetchImpl:async()=>{
      stripeCalls++;
      return new Response(JSON.stringify({id:'cs_retry',url:'https://checkout.stripe.com/c/pay/cs_retry',status:'open'}),{status:200});
    }
  });
  assert.equal(result.checkoutSessionId,'cs_retry');
  assert.equal(consumeCalls,0);
  assert.equal(stripeCalls,1);
});

test('different approval JTI cannot replace persisted authorization',async()=>{
  const {svc}=service({approvalJti:'approval-existing'});
  let stripeCalls=0;
  await assert.rejects(
    svc.createCheckout({
      ...args,
      approval:{jti:'approval-other',consume:async()=>true},
      fetchImpl:async()=>{stripeCalls++;throw new Error('should_not_call');}
    }),
    /provider_transaction_approval_conflict/
  );
  assert.equal(stripeCalls,0);
});


test('retry reuses persisted Shopify draft order instead of creating a duplicate',async()=>{
  const harness=service({approvalJti:'approval-1',providerDraftOrderId:'gid://shopify/DraftOrder/77'});
  let stripeCalls=0;
  const result=await harness.svc.createCheckout({
    ...args,
    approval:{jti:'approval-1',consume:async()=>false},
    fetchImpl:async()=>{
      stripeCalls++;
      return new Response(JSON.stringify({id:'cs_reuse',url:'https://checkout.stripe.com/c/pay/cs_reuse',status:'open'}),{status:200});
    }
  });
  assert.equal(result.checkoutSessionId,'cs_reuse');
  assert.equal(harness.draftCreateCalls,0);
  assert.equal(stripeCalls,1);
});


test('stale preparation recovers existing Shopify draft before any recreate',async()=>{
  const harness=service({
    approvalJti:'approval-1',
    stalePreparation:true,
    recoveredDraftOrderId:'gid://shopify/DraftOrder/88'
  });
  let stripeCalls=0;
  const result=await harness.svc.createCheckout({
    ...args,
    approval:{jti:'approval-1',consume:async()=>false},
    fetchImpl:async()=>{
      stripeCalls++;
      return new Response(JSON.stringify({id:'cs_recovered',url:'https://checkout.stripe.com/c/pay/cs_recovered',status:'open'}),{status:200});
    }
  });
  assert.equal(result.checkoutSessionId,'cs_recovered');
  assert.equal(harness.recoveryCalls,1);
  assert.equal(harness.draftCreateCalls,0);
  assert.equal(harness.intents.providerDraftOrderId,'gid://shopify/DraftOrder/88');
  assert.equal(stripeCalls,1);
});


test('ambiguous Shopify draft create failure remains quarantined before Stripe',async()=>{
  const harness=service({approvalJti:'approval-1',createDraftError:'shopify_network_timeout'});
  let stripeCalls=0;
  await assert.rejects(
    harness.svc.createCheckout({
      ...args,
      approval:{jti:'approval-1',consume:async()=>false},
      fetchImpl:async()=>{
        stripeCalls++;
        throw new Error('stripe_should_not_run');
      }
    }),
    /shopify_network_timeout/
  );
  assert.equal(harness.draftCreateCalls,1);
  assert.equal(harness.restoreCalls,0);
  assert.equal(stripeCalls,0);
});


test('merchant checkout URL is rejected before it can be returned to Muse',async()=>{
  const {svc}=service();
  await assert.rejects(
    svc.createCheckout({
      ...args,
      fetchImpl:async()=>new Response(JSON.stringify({
        id:'cs_bad',
        url:'https://example-shop.myshopify.com/checkouts/abc',
        status:'open'
      }),{status:200})
    }),
    /stripe_checkout_url_untrusted/
  );
});


test('verified saved Stripe authorization completes without checkout handoff',async()=>{
  const {svc,intents}=service();
  const calls:string[]=[];
  const result=await svc.createCheckout({
    ...args,
    savedStripeAuthorization:{customerId:'cus_123',paymentMethodId:'pm_123',usage:'off_session'},
    fetchImpl:async(url,init)=>{
      const value=String(url);
      calls.push(value);
      if(value==='https://api.stripe.com/v1/payment_intents'){
        const form=new URLSearchParams(String(init?.body));
        assert.equal(form.get('customer'),'cus_123');
        assert.equal(form.get('payment_method'),'pm_123');
        return new Response(JSON.stringify({id:'pi_direct_123',status:'requires_confirmation'}),{status:200});
      }
      if(value.endsWith('/payment_intents/pi_direct_123/confirm')){
        const form=new URLSearchParams(String(init?.body));
        assert.equal(form.get('off_session'),'true');
        assert.equal(form.get('error_on_requires_action'),'true');
        return new Response(JSON.stringify({id:'pi_direct_123',status:'succeeded'}),{status:200});
      }
      throw new Error('unexpected_stripe_call:'+value);
    }
  });
  assert.equal(result.paymentReference,'pi_direct_123');
  assert.equal(result.paymentReferenceKind,'payment_intent');
  assert.equal(result.handoff.required,false);
  assert.equal(intents.paymentReference,'pi_direct_123');
  assert.equal(intents.paymentReferenceKind,'payment_intent');
  assert.equal(calls.some(url=>url.includes('/checkout/sessions')),false);
});

test('authentication-required direct payment is canceled before trusted checkout fallback',async()=>{
  const {svc,intents}=service();
  const calls:string[]=[];
  const result=await svc.createCheckout({
    ...args,
    savedStripeAuthorization:{customerId:'cus_123',paymentMethodId:'pm_123',usage:'off_session'},
    fetchImpl:async(url)=>{
      const value=String(url);
      calls.push(value);
      if(value==='https://api.stripe.com/v1/payment_intents'){
        return new Response(JSON.stringify({id:'pi_blocked_123',status:'requires_confirmation'}),{status:200});
      }
      if(value.endsWith('/payment_intents/pi_blocked_123/confirm')){
        return new Response(JSON.stringify({error:{code:'authentication_required'}}),{status:402});
      }
      if(value.endsWith('/payment_intents/pi_blocked_123/cancel')){
        return new Response(JSON.stringify({id:'pi_blocked_123',status:'canceled'}),{status:200});
      }
      if(value==='https://api.stripe.com/v1/checkout/sessions'){
        return new Response(JSON.stringify({id:'cs_fallback_123',url:'https://checkout.stripe.com/c/pay/cs_fallback_123',status:'open'}),{status:200});
      }
      throw new Error('unexpected_stripe_call:'+value);
    }
  });
  assert.equal(result.paymentReference,'cs_fallback_123');
  assert.equal(result.paymentReferenceKind,'checkout_session');
  assert.equal(result.handoff.required,true);
  assert.equal(intents.paymentReference,'cs_fallback_123');
  assert.equal(intents.paymentReferenceKind,'checkout_session');
  assert.deepEqual(calls,[
    'https://api.stripe.com/v1/payment_intents',
    'https://api.stripe.com/v1/payment_intents/pi_blocked_123/confirm',
    'https://api.stripe.com/v1/payment_intents/pi_blocked_123/cancel',
    'https://api.stripe.com/v1/checkout/sessions'
  ]);
});


test('retry after checkout creation failure skips canceled direct PaymentIntent and resumes fallback',async()=>{
  const harness=service();
  const firstCalls:string[]=[];
  await assert.rejects(
    harness.svc.createCheckout({
      ...args,
      savedStripeAuthorization:{customerId:'cus_retry',paymentMethodId:'pm_retry',usage:'off_session'},
      fetchImpl:async(url)=>{
        const value=String(url);
        firstCalls.push(value);
        if(value==='https://api.stripe.com/v1/payment_intents'){
          return new Response(JSON.stringify({id:'pi_retry_blocked',status:'requires_confirmation'}),{status:200});
        }
        if(value.endsWith('/payment_intents/pi_retry_blocked/confirm')){
          return new Response(JSON.stringify({error:{code:'authentication_required'}}),{status:402});
        }
        if(value.endsWith('/payment_intents/pi_retry_blocked/cancel')){
          return new Response(JSON.stringify({id:'pi_retry_blocked',status:'canceled'}),{status:200});
        }
        if(value==='https://api.stripe.com/v1/checkout/sessions'){
          return new Response(JSON.stringify({error:{message:'temporary'}}),{status:503});
        }
        throw new Error('unexpected_first_call:'+value);
      }
    }),
    /stripe_checkout_failed:503/
  );
  assert.equal(harness.intents.state,'PAYMENT_FALLBACK_PENDING');
  assert.equal(harness.intents.paymentReference,'pi_retry_blocked');

  const secondCalls:string[]=[];
  const result=await harness.svc.createCheckout({
    ...args,
    approval:{jti:'approval-1',consume:async()=>false},
    savedStripeAuthorization:{customerId:'cus_retry',paymentMethodId:'pm_retry',usage:'off_session'},
    fetchImpl:async(url)=>{
      const value=String(url);
      secondCalls.push(value);
      if(value==='https://api.stripe.com/v1/checkout/sessions'){
        return new Response(JSON.stringify({id:'cs_retry_fallback',url:'https://checkout.stripe.com/c/pay/cs_retry_fallback',status:'open'}),{status:200});
      }
      throw new Error('retry_must_not_touch_direct_payment:'+value);
    }
  });
  assert.deepEqual(firstCalls,[
    'https://api.stripe.com/v1/payment_intents',
    'https://api.stripe.com/v1/payment_intents/pi_retry_blocked/confirm',
    'https://api.stripe.com/v1/payment_intents/pi_retry_blocked/cancel',
    'https://api.stripe.com/v1/checkout/sessions'
  ]);
  assert.deepEqual(secondCalls,['https://api.stripe.com/v1/checkout/sessions']);
  assert.equal(result.paymentReference,'cs_retry_fallback');
  assert.equal(result.paymentReferenceKind,'checkout_session');
  assert.equal(harness.intents.state,'CHECKOUT_CREATED');
});
