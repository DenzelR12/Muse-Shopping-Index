import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCompanyLearning,applyCompanyAdjustment,summarizeExplanationVariants} from '../dist/company-learning.js';

const good=[
  {eventId:'1',companyId:'good',offerId:'a',intentFingerprint:'x',stage:'IMPRESSION',occurredAt:'2026-10-01',listedPrice:90,comparableMedianPrice:100,explanationVariant:'why-fit',convertedAfterExplanation:true},
  {eventId:'2',companyId:'good',offerId:'a',intentFingerprint:'x',stage:'DRAFTED',occurredAt:'2026-10-01'},
  {eventId:'3',companyId:'good',offerId:'a',intentFingerprint:'x',stage:'APPROVED',occurredAt:'2026-10-01'},
  {eventId:'4',companyId:'good',offerId:'a',intentFingerprint:'x',stage:'PURCHASED',occurredAt:'2026-10-01'},
  {eventId:'5',companyId:'good',offerId:'a',intentFingerprint:'x',stage:'DELIVERED',occurredAt:'2026-10-02',promisedAt:'2026-10-03T00:00:00Z',deliveredAt:'2026-10-02T00:00:00Z'}
];

const bad=[
  {eventId:'6',companyId:'bad',offerId:'b',intentFingerprint:'x',stage:'IMPRESSION',occurredAt:'2026-10-01',listedPrice:120,comparableMedianPrice:100,explanationVariant:'generic',convertedAfterExplanation:false},
  {eventId:'7',companyId:'bad',offerId:'b',intentFingerprint:'x',stage:'DRAFTED',occurredAt:'2026-10-01'},
  {eventId:'8',companyId:'bad',offerId:'b',intentFingerprint:'x',stage:'PURCHASED',occurredAt:'2026-10-01'},
  {eventId:'9',companyId:'bad',offerId:'b',intentFingerprint:'x',stage:'RETURNED',occurredAt:'2026-10-02'},
  {eventId:'10',companyId:'bad',offerId:'b',intentFingerprint:'x',stage:'CANCELLED',occurredAt:'2026-10-02'}
];

test('company learning rewards reliable fulfillment and competitive pricing',()=>{
  const summaries=summarizeCompanyLearning([...good,...bad]);
  assert.ok(summaries.get('good').scoreAdjustment>summaries.get('bad').scoreAdjustment);
});

test('company adjustment remains bounded',()=>{
  const summary=summarizeCompanyLearning(good).get('good');
  const adjusted=applyCompanyAdjustment(99,summary);
  assert.ok(adjusted.score<=100);
});

test('explanation variants rank by observed conversion with confidence',()=>{
  const variants=summarizeExplanationVariants([...good,...bad]);
  assert.equal(variants[0].variant,'why-fit');
});
