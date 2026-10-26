import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReelDemoBridge,REEL_DEMO_BRIDGE_LABEL} from '../src/reel-demo-bridge.js';

const offer={
  offerId:'atlas-carry-on-22',
  companyId:'atlas-retail',
  entityId:'carry-on-22',
  kind:'PRODUCT',
  title:'Atlas Carry-On 22',
  price:289,
  currency:'USD',
  availability:'AVAILABLE',
  fulfillmentMode:'SHIP',
  attributes:{},
  intents:['travel'],
  actions:['BUY'],
  evidence:[{sourceId:'x',observedAt:'2026-10-24T15:00:00Z',sourceType:'CATALOG',fields:['price']}]
} as any;

const intent={
  intentId:'intent-1',
  source:{platform:'meta',reelId:'reel-1',caption:'Atlas Carry-On 22'},
  message:'Atlas Carry-On 22',
  interpretation:{intent:{query:'Atlas Carry-On 22'}},
  results:[{offer,score:90,reasons:['intent terms matched']}],
  next:'MUSE_REVIEW',
  merchantHandoffRequired:false
} as any;

const consumer={
  subjectId:'consumer-1',
  shopUserPublicId:'shop-user-1',
  shopIdentityVerifiedAt:'2026-10-25T19:00:00Z',
  paymentAuthorization:{rail:'stripe',reference:'pi_verified_1',verifiedAt:'2026-10-25T19:00:05Z'},
  shippingAddress:{name:'Buyer',address1:'123 Main St',city:'Atlanta',provinceCode:'GA',countryCode:'US',zip:'30303'},
  confirmationEmail:'buyer@example.com'
} as any;

test('demo Reel bridge collects all missing details in one batch before review',()=>{
  const result=buildReelDemoBridge({intent,selectedOfferId:'atlas-carry-on-22'});
  assert.equal(result.label,REEL_DEMO_BRIDGE_LABEL);
  assert.equal(result.next,'COLLECT_BATCH');
  assert.equal(result.review,null);
  assert.deepEqual(result.plan.missing,['shop_identity','payment_authorization','shipping_address','quantity','confirmation_email']);
  assert.equal(result.draft.signed,false);
  assert.equal(result.draft.draftId,null);
});

test('demo Reel bridge returns one exact review and no approval token when ready',()=>{
  const result=buildReelDemoBridge({intent,selectedOfferId:'atlas-carry-on-22',quantity:1,consumer});
  assert.equal(result.next,'FINAL_REVIEW');
  assert.equal(result.review?.title,'Atlas Carry-On 22');
  assert.equal(result.review?.quantity,1);
  assert.equal(result.review?.subtotal,289);
  assert.equal(result.review?.paymentLabel,'Saved payment');
  assert.equal(result.review?.approvalRequired,true);
  assert.equal(result.review?.approvalToken,null);
  assert.match(result.review?.shopBackendNote ?? '',/authorized on Shop/);
  assert.match(result.review?.shopBackendNote ?? '',/does not claim live Shop integration/);
});

test('demo Reel bridge rejects an offer that was not in the Reel intent',()=>{
  assert.throws(()=>buildReelDemoBridge({intent,selectedOfferId:'other-offer',quantity:1,consumer}),/reel_demo_offer_not_in_intent/);
});
