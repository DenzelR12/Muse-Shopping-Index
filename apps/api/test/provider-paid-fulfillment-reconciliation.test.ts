import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPaidCheckoutFulfillment,applyPaidPaymentFulfillment} from '../dist/provider-webhooks.js';

const intent={
  companyId:'org-a',
  draftId:'draft-1',
  paymentProvider:'stripe',
  paymentExternalAccountId:'acct-1',
  fulfillmentProvider:'shopify',
  fulfillmentExternalAccountId:'example-shop.myshopify.com',
  fulfillmentPayload:{lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}]},
  amount:125.5,
  currency:'USD',
  checkoutSessionId:'cs_paid_1',
  providerDraftOrderId:'gid://shopify/DraftOrder/55',
  state:'ORDER_EXECUTING',
  createdAt:'2026-10-25T00:00:00Z',
  updatedAt:'2026-10-25T00:00:00Z'
};

test('paid checkout completion success marks provider order created',async()=>{
  let markedOrder:string|undefined;
  let reconcileCalls=0;
  const result=await applyPaidCheckoutFulfillment({
    checkoutSessionId:'cs_paid_1',
    intents:{
      async claimPaidCheckout(id:string){
        assert.equal(id,'cs_paid_1');
        return intent as any;
      },
      async markOrderCreated(companyId:string,draftId:string,providerOrderId:string){
        assert.equal(companyId,'org-a');
        assert.equal(draftId,'draft-1');
        markedOrder=providerOrderId;
        return {...intent,state:'ORDER_CREATED',providerOrderId};
      },
      async markReconcileRequired(){reconcileCalls++;return null;}
    } as any,
    orderControl:{
      async completeDraftOrder(key:any,args:any){
        assert.equal(key.companyId,'org-a');
        assert.equal(args.draftOrderId,'gid://shopify/DraftOrder/55');
        return {result:{providerOrderId:'gid://shopify/Order/9001'}};
      },
      async createOrder(){throw new Error('legacy_create_should_not_run');}
    } as any
  });
  assert.equal(result.fulfillmentState,'ORDER_CREATED');
  assert.equal(result.providerOrderId,'gid://shopify/Order/9001');
  assert.equal(markedOrder,'gid://shopify/Order/9001');
  assert.equal(reconcileCalls,0);
});

test('ambiguous Shopify completion after Stripe payment requires reconciliation and never enters refund flow',async()=>{
  let orderCreatedCalls=0;
  let reconcileCalls=0;
  let refundTransitions=0;
  const intents={
    async claimPaidCheckout(){return intent as any;},
    async markOrderCreated(){orderCreatedCalls++;return null;},
    async markReconcileRequired(companyId:string,draftId:string){
      assert.equal(companyId,'org-a');
      assert.equal(draftId,'draft-1');
      reconcileCalls++;
      return {...intent,state:'RECONCILE_REQUIRED'};
    },
    async markRefundRequired(){refundTransitions++;return null;}
  };
  const result=await applyPaidCheckoutFulfillment({
    checkoutSessionId:'cs_paid_1',
    intents:intents as any,
    orderControl:{
      async completeDraftOrder(){
        throw new Error('shopify_completion_response_lost');
      },
      async createOrder(){throw new Error('legacy_create_should_not_run');}
    } as any
  });
  assert.equal(result.fulfillmentState,'RECONCILE_REQUIRED');
  assert.equal(orderCreatedCalls,0);
  assert.equal(reconcileCalls,1);
  assert.equal(refundTransitions,0);
});


test('succeeded direct PaymentIntent uses the same Shopify fulfillment path',async()=>{
  let claimedReference='';
  let claimedKind='';
  const result=await applyPaidPaymentFulfillment({
    paymentReference:'pi_direct_1',
    paymentReferenceKind:'payment_intent',
    intents:{
      async claimPaidPayment(reference:string,kind:string){
        claimedReference=reference;
        claimedKind=kind;
        return intent as any;
      },
      async markOrderCreated(){return {...intent,state:'ORDER_CREATED',providerOrderId:'gid://shopify/Order/9100'};},
      async markReconcileRequired(){return null;}
    } as any,
    orderControl:{
      async completeDraftOrder(){
        return {result:{providerOrderId:'gid://shopify/Order/9100'}};
      },
      async createOrder(){throw new Error('legacy_create_should_not_run');}
    } as any
  });
  assert.equal(claimedReference,'pi_direct_1');
  assert.equal(claimedKind,'payment_intent');
  assert.equal(result.fulfillmentState,'ORDER_CREATED');
  assert.equal(result.providerOrderId,'gid://shopify/Order/9100');
});
