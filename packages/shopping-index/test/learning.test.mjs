import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeLearning,applyLearnedAdjustment,intentFingerprint} from '../dist/learning.js';

const events=[
  {eventId:'1',offerId:'a',companyId:'c',kind:'PRODUCT',intentFingerprint:'carry-on|product|us|300-400',outcome:'IMPRESSION',occurredAt:'2026-10-24T00:00:00Z'},
  {eventId:'2',offerId:'a',companyId:'c',kind:'PRODUCT',intentFingerprint:'carry-on|product|us|300-400',outcome:'PURCHASED',occurredAt:'2026-10-24T00:01:00Z'},
  {eventId:'3',offerId:'a',companyId:'c',kind:'PRODUCT',intentFingerprint:'carry-on|product|us|300-400',outcome:'DELIVERED',occurredAt:'2026-10-25T00:00:00Z'},
  {eventId:'4',offerId:'a',companyId:'c',kind:'PRODUCT',intentFingerprint:'carry-on|product|us|300-400',outcome:'SATISFIED',occurredAt:'2026-10-26T00:00:00Z',satisfaction:5},
  {eventId:'5',offerId:'b',companyId:'c2',kind:'PRODUCT',intentFingerprint:'carry-on|product|us|300-400',outcome:'IMPRESSION',occurredAt:'2026-10-24T00:00:00Z'},
  {eventId:'6',offerId:'b',companyId:'c2',kind:'PRODUCT',intentFingerprint:'carry-on|product|us|300-400',outcome:'RETURNED',occurredAt:'2026-10-25T00:00:00Z'}
];

test('learning rewards successful fulfilled outcomes and penalizes returns',()=>{
  const learned=summarizeLearning(events);
  assert.ok(learned.get('a').scoreAdjustment>0);
  assert.ok(learned.get('b').scoreAdjustment<0);
});

test('learning cannot dominate the base rank',()=>{
  const learned=summarizeLearning(events);
  const adjusted=applyLearnedAdjustment(95,learned.get('a'));
  assert.ok(adjusted.score<=100);
  const cold=applyLearnedAdjustment(60,undefined);
  assert.equal(cold.score,60);
});

test('intent fingerprint is coarse and non-identifying',()=>{
  assert.equal(intentFingerprint({normalizedQuery:' Carry-On ',kind:'PRODUCT',region:'US',budgetBucket:'300-400'}),'carry-on|product|us|300-400');
});
