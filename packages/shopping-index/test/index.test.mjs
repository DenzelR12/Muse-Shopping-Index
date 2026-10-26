import test from 'node:test';
import assert from 'node:assert/strict';
import {indexEligibility,searchShoppingIndex,mergeCompanyOffers} from '../dist/index.js';

const offers=[
  {
    offerId:'retail-1',companyId:'retailer-a',entityId:'bag-1',kind:'PRODUCT',
    title:'Premium Carry-On',summary:'Lightweight travel carry-on',price:299,currency:'USD',
    availability:'AVAILABLE',destinationOrRegion:'US',fulfillmentMode:'SHIP',
    attributes:{material:'polycarbonate'},intents:['travel','carry-on','luggage'],
    actions:['VIEW','ADD_TO_CART','BUY'],
    evidence:[{sourceId:'api-a',observedAt:'2026-10-24T14:00:00.000Z',sourceType:'COMPANY_CONNECTOR',fields:['price','availability']}]
  },
  {
    offerId:'travel-1',companyId:'travel-a',entityId:'trip-1',kind:'TRAVEL',
    title:'Theme Park Family Package',summary:'Hotel and two park days',price:3800,currency:'USD',
    availability:'LIMITED',destinationOrRegion:'Orlando',fulfillmentMode:'BOOKING',
    attributes:{parkDays:2},intents:['family','theme park','hotel'],
    actions:['VIEW','CONFIGURE','BOOK'],
    evidence:[{sourceId:'booking-a',observedAt:'2026-10-24T14:00:00.000Z',sourceType:'BOOKING_API',fields:['price','availability','dates']}]
  }
];

test('index accepts actionable evidence-backed offers',()=>{
  assert.equal(indexEligibility(offers[0],new Date('2026-10-24T14:10:00.000Z')).eligible,true);
});

test('index ranks across companies and entity kinds from one intent',()=>{
  const results=searchShoppingIndex(
    {query:'family theme park hotel',maxPrice:4000,currency:'USD',destinationOrRegion:'Orlando'},
    offers,
    5,
    new Date('2026-10-24T14:10:00.000Z')
  );
  assert.equal(results[0].offer.offerId,'travel-1');
});

test('company refresh replaces the same offer id instead of duplicating it',()=>{
  const merged=mergeCompanyOffers([offers[0]],[{...offers[0],price:279}]);
  assert.equal(merged.length,1);
  assert.equal(merged[0].price,279);
});
