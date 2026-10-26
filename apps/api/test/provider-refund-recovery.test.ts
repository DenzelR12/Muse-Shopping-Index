import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileSubmittedRefunds} from '../dist/provider-refund-recovery.js';

function intent(draftId:string,refundId:string){
  return {
    companyId:'org-a',
    draftId,
    paymentProvider:'stripe',
    paymentExternalAccountId:'acct-1',
    fulfillmentProvider:'shopify',
    fulfillmentExternalAccountId:'example.myshopify.com',
    fulfillmentPayload:{},
    amount:125.5,
    currency:'USD',
    checkoutSessionId:'cs_test',
    refundId,
    state:'REFUND_SUBMITTED',
    createdAt:'2026-10-25T00:00:00Z',
    updatedAt:'2026-10-25T00:00:00Z'
  };
}

test('stale submitted refunds are finalized from Stripe status',async()=>{
  const rows=[intent('d1','re_success'),intent('d2','re_failed'),intent('d3','re_pending')];
  const events:any[]=[];
  const intents={
    async listStaleRefundSubmitted(olderThan:Date,limit:number){
      assert.equal(olderThan.toISOString(),'2026-10-25T02:50:00.000Z');
      assert.equal(limit,20);
      return rows;
    },
    async markRefunded(_c:string,d:string){return {...rows.find(x=>x.draftId===d),state:'REFUNDED'};},
    async markRefundFailed(_c:string,d:string){return {...rows.find(x=>x.draftId===d),state:'REFUND_REQUIRED'};}
  };
  const auditor={async record(type:string,metadata:any){events.push({type,metadata});}};
  const fetchImpl=async(url:any)=>{
    const id=String(url).split('/').pop();
    const status=id==='re_success'?'succeeded':id==='re_failed'?'failed':'pending';
    return new Response(JSON.stringify({id,status,metadata:{company_id:'org-a'}}),{status:200,headers:{'content-type':'application/json'}});
  };
  const result=await reconcileSubmittedRefunds({
    intents:intents as any,
    auditor:auditor as any,
    stripeSecret:'sk_test',
    fetchImpl:fetchImpl as any,
    now:new Date('2026-10-25T03:00:00Z'),
    staleMinutes:10,
    limit:20
  });
  assert.deepEqual(
    {checked:result.checked,refunded:result.refunded,reopened:result.reopened,pending:result.pending,failed:result.failed},
    {checked:3,refunded:1,reopened:1,pending:1,failed:0}
  );
  assert.deepEqual(events.map(x=>x.type),['provider.transaction.refunded','provider.transaction.refund_failed']);
});

test('one Stripe lookup failure does not block other refund recovery',async()=>{
  const rows=[intent('d1','re_error'),intent('d2','re_success')];
  let finalized=0;
  const intents={
    async listStaleRefundSubmitted(){return rows;},
    async markRefunded(){finalized++;return {...rows[1],state:'REFUNDED'};},
    async markRefundFailed(){throw new Error('should_not_call');}
  };
  const fetchImpl=async(url:any)=>{
    if(String(url).endsWith('re_error')) return new Response('down',{status:503});
    return new Response(JSON.stringify({id:'re_success',status:'succeeded'}),{status:200,headers:{'content-type':'application/json'}});
  };
  const result=await reconcileSubmittedRefunds({
    intents:intents as any,
    stripeSecret:'sk_test',
    fetchImpl:fetchImpl as any,
    now:new Date('2026-10-25T03:00:00Z')
  });
  assert.equal(result.failed,1);
  assert.equal(result.refunded,1);
  assert.equal(finalized,1);
});

test('still-pending Stripe refunds remain submitted',async()=>{
  const rows=[intent('d1','re_pending')];
  let mutations=0;
  const intents={
    async listStaleRefundSubmitted(){return rows;},
    async markRefunded(){mutations++;return null;},
    async markRefundFailed(){mutations++;return null;}
  };
  const result=await reconcileSubmittedRefunds({
    intents:intents as any,
    stripeSecret:'sk_test',
    fetchImpl:async()=>new Response(JSON.stringify({id:'re_pending',status:'pending'}),{status:200,headers:{'content-type':'application/json'}}) as any,
    now:new Date('2026-10-25T03:00:00Z')
  });
  assert.equal(result.pending,1);
  assert.equal(mutations,0);
});
