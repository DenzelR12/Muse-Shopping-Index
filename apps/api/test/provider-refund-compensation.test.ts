import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderRefundCompensationService} from '../dist/provider-refund-compensation.js';

function service(overrides:{state?:string;persistFails?:boolean}={}){
  let state=overrides.state??'REFUND_REQUIRED';
  let refundId;
  const events=[];
  const intents={
    async claimRefund(){
      if(!['REFUND_REQUIRED','REFUND_EXECUTING'].includes(state)) return null;
      state='REFUND_EXECUTING';
      return {
        companyId:'org-a',
        draftId:'draft-1',
        paymentProvider:'stripe',
        paymentExternalAccountId:'acct-1',
        fulfillmentProvider:'shopify',
        fulfillmentExternalAccountId:'example.myshopify.com',
        fulfillmentPayload:{},
        amount:125.5,
        currency:'USD',
        checkoutSessionId:'cs_test_123',
        state
      };
    },
    async restoreRefundRequired(){
      if(state==='REFUND_EXECUTING') state='REFUND_REQUIRED';
      return {state};
    },
    async markRefundSubmitted(_companyId:string,_draftId:string,id:string){
      if(overrides.persistFails) return null;
      state='REFUND_SUBMITTED';
      refundId=id;
      return {
        companyId:'org-a',
        draftId:'draft-1',
        paymentProvider:'stripe',
        paymentExternalAccountId:'acct-1',
        fulfillmentProvider:'shopify',
        fulfillmentExternalAccountId:'example.myshopify.com',
        fulfillmentPayload:{},
        amount:125.5,
        currency:'USD',
        checkoutSessionId:'cs_test_123',
        refundId,
        state
      };
    }
  };
  const auditor={async record(type:string,metadata:any){events.push({type,metadata});}};
  return {
    svc:new ProviderRefundCompensationService(intents as any,auditor as any,'sk_test'),
    events,
    getState:()=>state
  };
}

function stripeSuccess(){
  return async(url:any,init:any={})=>{
    if(String(url).includes('/checkout/sessions/')){
      return new Response(JSON.stringify({payment_intent:'pi_123',payment_status:'paid'}),{status:200,headers:{'content-type':'application/json'}});
    }
    assert.equal(init.headers['idempotency-key'],'gift-signal:refund:org-a:draft-1');
    return new Response(JSON.stringify({id:'re_123',status:'succeeded'}),{status:200,headers:{'content-type':'application/json'}});
  };
}

test('refund compensation records submission and waits for webhook finality',async()=>{
  const {svc,events,getState}=service();
  const result=await svc.refund({
    companyId:'org-a',
    draftId:'draft-1',
    requestId:'req-1',
    fetchImpl:stripeSuccess() as any
  });
  assert.equal(result.refund.refundId,'re_123');
  assert.equal(result.transaction.state,'REFUND_SUBMITTED');
  assert.equal(getState(),'REFUND_SUBMITTED');
  assert.equal(events.length,1);
  assert.equal(events[0].type,'provider.transaction.refund_submitted');
  assert.equal(events[0].metadata.amount,125.5);
});

test('failed Stripe refund returns transaction to refund-required for retry',async()=>{
  const {svc,getState}=service();
  await assert.rejects(
    svc.refund({
      companyId:'org-a',
      draftId:'draft-1',
      fetchImpl:async(url:any)=>{
        if(String(url).includes('/checkout/sessions/')){
          return new Response(JSON.stringify({payment_intent:'pi_123',payment_status:'paid'}),{status:200,headers:{'content-type':'application/json'}});
        }
        return new Response(JSON.stringify({error:'temporary'}),{status:503});
      }
    }),
    /stripe_refund_failed:503/
  );
  assert.equal(getState(),'REFUND_REQUIRED');
});

test('ambiguous persistence keeps executing state so idempotent refund can be retried',async()=>{
  const {svc,getState}=service({persistFails:true});
  await assert.rejects(
    svc.refund({
      companyId:'org-a',
      draftId:'draft-1',
      fetchImpl:stripeSuccess() as any
    }),
    /provider_refund_persist_failed/
  );
  assert.equal(getState(),'REFUND_EXECUTING');
});

test('refund cannot execute for transaction outside compensation state',async()=>{
  const {svc}=service({state:'ORDER_CREATED'});
  let externalCalls=0;
  await assert.rejects(
    svc.refund({
      companyId:'org-a',
      draftId:'draft-1',
      fetchImpl:async()=>{externalCalls++;throw new Error('should_not_call');}
    }),
    /provider_refund_not_required/
  );
  assert.equal(externalCalls,0);
});
