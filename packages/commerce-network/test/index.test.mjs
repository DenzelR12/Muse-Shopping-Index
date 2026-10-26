import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTrustTier,
  approvePlan,
  rankIntentOffers,
  buildMerchantDiagnostics,
  outcomeEffortScore
} from '../dist/index.js';

test('trust tier rewards reliable companies only after enough observations',()=>{
  const base={
    companyId:'a',verticals:['retail'],identityVerified:true,apiUptime:.99,inventoryAccuracy:.98,
    deliverySuccess:.97,onTimeRate:.95,returnResolutionRate:.94,supportResolutionRate:.93,
    priceConsistency:.98,policyCompliance:.99,evidenceFreshness:.99
  };
  assert.equal(deriveTrustTier({...base,observations:10}),'VERIFIED');
  assert.equal(deriveTrustTier({...base,observations:200}),'AUTONOMOUS_READY');
});

test('consolidated approval respects consumer automation policy',()=>{
  const plan={
    planId:'p',subjectId:'u',intent:'trip',total:120,currency:'USD',approvalRequired:true,expiresAt:'2026-10-24T18:00:00Z',
    actions:[
      {actionId:'a1',companyId:'c1',offerId:'o1',vertical:'retail',kind:'PURCHASE',amount:40,currency:'USD'},
      {actionId:'a2',companyId:'c2',offerId:'o2',vertical:'travel',kind:'BOOKING',amount:80,currency:'USD',refundable:true}
    ]
  };
  const result=approvePlan(plan,[{policyId:'x',subjectId:'u',vertical:'retail',action:'BUY',mode:'ALLOW_UNDER_LIMIT',maxAmount:50,currency:'USD'}],{
    approvalId:'ap',planId:'p',subjectId:'u',approvedActionIds:['a1','a2'],declinedActionIds:[],approvedAt:'2026-10-24T16:00:00Z'
  },new Date('2026-10-24T16:10:00Z'));
  assert.equal(result.approved.length,2);
});

test('intent offers favor trust before minor price differences',()=>{
  const trust=new Map([
    ['good',{companyId:'good',verticals:['retail'],identityVerified:true,apiUptime:.99,inventoryAccuracy:.99,deliverySuccess:.99,onTimeRate:.99,returnResolutionRate:.99,supportResolutionRate:.99,priceConsistency:.99,policyCompliance:.99,evidenceFreshness:.99,tier:'AUTONOMOUS_READY',observations:500}],
    ['weak',{companyId:'weak',verticals:['retail'],identityVerified:true,apiUptime:.8,inventoryAccuracy:.7,deliverySuccess:.7,onTimeRate:.7,returnResolutionRate:.7,supportResolutionRate:.7,priceConsistency:.8,policyCompliance:.8,evidenceFreshness:.8,tier:'VERIFIED',observations:500}]
  ]);
  const ranked=rankIntentOffers([
    {offerId:'cheap',companyId:'weak',intentFingerprint:'x',price:90,currency:'USD',expiresAt:'2026-10-24T18:00:00Z',evidenceId:'e1'},
    {offerId:'better',companyId:'good',intentFingerprint:'x',price:95,currency:'USD',expiresAt:'2026-10-24T18:00:00Z',evidenceId:'e2'}
  ],trust,new Date('2026-10-24T16:00:00Z'));
  assert.equal(ranked[0].offer.offerId,'better');
});

test('merchant diagnostics highlight latency, inventory and abandonment gaps',()=>{
  const d=buildMerchantDiagnostics({companyId:'c',apiLatencyMs:500,verticalMedianLatencyMs:200,inventoryAccuracy:.7,verticalMedianInventoryAccuracy:.9,abandonmentRate:.5,verticalMedianAbandonmentRate:.2});
  assert.equal(d.length,3);
});

test('north-star outcome effort score rewards completed low-effort journeys',()=>{
  assert.equal(outcomeEffortScore({completed:true,consumerActions:2,recoveryActions:0}),.5);
  assert.equal(outcomeEffortScore({completed:false,consumerActions:1,recoveryActions:0}),0);
});
