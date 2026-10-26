import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMuseCheckoutPlan} from '../src/checkout-plan.js';

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

test('Muse asks for every missing checkout field in one batch',()=>{
  const plan=buildMuseCheckoutPlan({intentId:'intent-1',offer});
  assert.equal(plan.readyForApproval,false);
  assert.equal(plan.next,'COLLECT_BATCH');
  assert.deepEqual(plan.missing,[
    'shop_identity',
    'payment_authorization',
    'shipping_address',
    'quantity',
    'confirmation_email'
  ]);
});

test('complete checkout context advances directly to one final review',()=>{
  const plan=buildMuseCheckoutPlan({
    intentId:'intent-1',
    offer,
    quantity:1,
    consumer:{
      subjectId:'consumer-1',
      shopUserPublicId:'shop-user-1',
      shopIdentityVerifiedAt:'2026-10-25T19:00:00Z',
      paymentAuthorization:{
        rail:'shop_pay',
        reference:'shop-pay-auth-1',
        verifiedAt:'2026-10-25T19:00:05Z'
      },
      shippingAddress:{
        name:'Buyer',
        address1:'123 Main St',
        city:'Atlanta',
        provinceCode:'GA',
        countryCode:'US',
        zip:'30303'
      },
      confirmationEmail:'buyer@example.com'
    }
  });
  assert.equal(plan.readyForApproval,true);
  assert.equal(plan.next,'FINAL_REVIEW');
  assert.deepEqual(plan.missing,[]);
  assert.equal(plan.subtotal,289);
  assert.equal(plan.consumer.paymentRail,'shop_pay');
});

test('Stripe authorization is accepted as a payment rail without requiring a Stripe merchant identity',()=>{
  const plan=buildMuseCheckoutPlan({
    intentId:'intent-2',
    offer:{...offer,fulfillmentMode:'DIGITAL'},
    quantity:2,
    consumer:{
      shopUserPublicId:'shop-user-2',
      shopIdentityVerifiedAt:'2026-10-25T19:00:00Z',
      paymentAuthorization:{
        rail:'stripe',
        reference:'pi_verified_1',
        verifiedAt:'2026-10-25T19:00:05Z'
      },
      confirmationEmail:'buyer@example.com'
    }
  });
  assert.equal(plan.readyForApproval,true);
  assert.equal(plan.consumer.paymentRail,'stripe');
  assert.equal(plan.subtotal,578);
});
