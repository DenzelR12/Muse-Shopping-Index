import test from 'node:test';
import assert from 'node:assert/strict';
import {applyStripeRefundEvent} from '../dist/provider-webhooks.js';

const transaction={
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
  refundId:'re_123',
  state:'REFUND_SUBMITTED',
  createdAt:'2026-10-25T00:00:00Z',
  updatedAt:'2026-10-25T00:00:00Z'
};

test('Stripe refund succeeded webhook finalizes submitted refund',async()=>{
  const events:any[]=[];
  const intents={
    async markRefunded(companyId:string,draftId:string,refundId:string){
      assert.equal(companyId,'org-a');
      assert.equal(draftId,'draft-1');
      assert.equal(refundId,'re_123');
      return {...transaction,state:'REFUNDED'};
    },
    async markRefundFailed(){throw new Error('should_not_call');}
  };
  const auditor={async record(type:string,metadata:any){events.push({type,metadata});}};
  const result=await applyStripeRefundEvent({
    eventType:'refund.updated',
    refund:{id:'re_123',status:'succeeded',metadata:{company_id:'org-a',draft_id:'draft-1'}},
    intents:intents as any,
    auditor:auditor as any
  });
  assert.equal(result,'REFUNDED');
  assert.equal(events[0].type,'provider.transaction.refunded');
});

test('Stripe refund failure reopens refund-required compensation state',async()=>{
  const events:any[]=[];
  const intents={
    async markRefunded(){throw new Error('should_not_call');},
    async markRefundFailed(companyId:string,draftId:string,refundId:string){
      assert.equal(companyId,'org-a');
      assert.equal(draftId,'draft-1');
      assert.equal(refundId,'re_123');
      return {...transaction,state:'REFUND_REQUIRED'};
    }
  };
  const auditor={async record(type:string,metadata:any){events.push({type,metadata});}};
  const result=await applyStripeRefundEvent({
    eventType:'refund.failed',
    refund:{id:'re_123',status:'failed',metadata:{company_id:'org-a',draft_id:'draft-1'}},
    intents:intents as any,
    auditor:auditor as any
  });
  assert.equal(result,'REFUND_REQUIRED');
  assert.equal(events[0].type,'provider.transaction.refund_failed');
});

test('pending refund remains submitted until Stripe confirms final state',async()=>{
  let mutations=0;
  const intents={
    async markRefunded(){mutations++;return null;},
    async markRefundFailed(){mutations++;return null;}
  };
  const result=await applyStripeRefundEvent({
    eventType:'refund.updated',
    refund:{id:'re_123',status:'pending',metadata:{company_id:'org-a',draft_id:'draft-1'}},
    intents:intents as any
  });
  assert.equal(result,'REFUND_SUBMITTED');
  assert.equal(mutations,0);
});

test('refund webhook without transaction metadata is unmatched and cannot mutate state',async()=>{
  let mutations=0;
  const intents={
    async markRefunded(){mutations++;return null;},
    async markRefundFailed(){mutations++;return null;}
  };
  const result=await applyStripeRefundEvent({
    eventType:'refund.updated',
    refund:{id:'re_123',status:'succeeded'},
    intents:intents as any
  });
  assert.equal(result,'UNMATCHED');
  assert.equal(mutations,0);
});
