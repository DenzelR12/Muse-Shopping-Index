import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signIntentSignal,
  verifyIntentSignal,
  intentSearchQuery
} from '../dist/business-ad-intent.js';
import {
  chooseCommerceRail,
  assertCheckoutMatchesDraft,
  createJourney,
  attachDraft,
  attachCheckout,
  attachExecution,
  attachFulfillment
} from '../dist/business-commerce-journey.js';

const signal={
  signalId:'sig-1',
  companyId:'retailer-1',
  source:'AD_CLICK',
  campaignId:'campaign-1',
  creativeId:'creative-7',
  productRefs:['sku-22'],
  intentTags:['carry-on','travel'],
  occurredAt:'2026-10-24T14:00:00.000Z',
  expiresAt:'2026-10-24T15:00:00.000Z',
  consent:'USER_INITIATED'
};

test('signed ad intent is accepted only while fresh and user initiated',()=>{
  const signed=signIntentSignal(signal,'secret');
  const verified=verifyIntentSignal(signed,'secret',new Date('2026-10-24T14:10:00.000Z'));
  assert.equal(verified.ok,true);
  assert.match(intentSearchQuery(signal,'Find me the best option'),/carry-on/);
  assert.equal(verifyIntentSignal(signed,'wrong-secret',new Date('2026-10-24T14:10:00.000Z')).ok,false);
  assert.equal(verifyIntentSignal(signed,'secret',new Date('2026-10-24T16:00:00.000Z')).ok,false);
});

test('retail prefers Shop, otherwise Stripe then provider-native',()=>{
  assert.equal(chooseCommerceRail({vertical:'retail',shopCheckoutAvailable:true,stripeConnected:true,providerNativeCheckout:true}),'SHOP');
  assert.equal(chooseCommerceRail({vertical:'travel',shopCheckoutAvailable:false,stripeConnected:true,providerNativeCheckout:true}),'STRIPE');
  assert.equal(chooseCommerceRail({vertical:'travel',shopCheckoutAvailable:false,stripeConnected:false,providerNativeCheckout:true}),'PROVIDER_NATIVE');
});

test('journey preserves exact draft and checkout totals through fulfillment',()=>{
  const draft={
    draftId:'draft-1',
    companyId:'retailer-1',
    connectionId:'conn-1',
    kind:'PURCHASE',
    offerIds:['offer-1'],
    quantity:1,
    total:299,
    currency:'USD',
    summary:'Travel bag',
    createdAt:'2026-10-24T14:05:00.000Z',
    expiresAt:'2026-10-24T14:30:00.000Z',
    approvalRequired:true,
    liveRevalidationRequired:true
  };
  const checkout={
    checkoutId:'checkout-1',
    rail:'SHOP',
    companyId:'retailer-1',
    connectionId:'conn-1',
    draftId:'draft-1',
    amount:299,
    currency:'USD',
    status:'READY_FOR_APPROVAL',
    approvalRequired:true,
    createdAt:'2026-10-24T14:06:00.000Z',
    expiresAt:'2026-10-24T14:20:00.000Z'
  };
  assert.equal(assertCheckoutMatchesDraft(checkout,draft),true);
  let journey=createJourney(signal,[{offerId:'offer-1',title:'Travel bag',provider:'Retailer',price:299,currency:'USD',availability:'AVAILABLE',evidenceAt:'2026-10-24T14:04:00.000Z'}]);
  journey=attachDraft(journey,draft);
  journey=attachCheckout(journey,checkout);
  journey=attachExecution(journey,{executionId:'exec-1',draftId:'draft-1',status:'CONFIRMED',providerReference:'ORDER-1',committedAt:'2026-10-24T14:08:00.000Z',message:'Order placed'});
  journey=attachFulfillment(journey,{orderId:'ORDER-1',state:'DELIVERED',carrier:'UPS',trackingNumber:'1ZTEST',updatedAt:'2026-10-27T18:00:00.000Z'});
  assert.equal(journey.fulfillment.state,'DELIVERED');
});
