import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCompanyIntelligence,effectiveMetricStatus} from '../dist/company-intelligence.js';

test('company report is tenant scoped and summarizes API/ad efficiency',()=>{
 const report=summarizeCompanyIntelligence({
  companyId:'acme',
  now:new Date('2026-10-24T16:00:00Z'),
  apiCalls:[
   {companyId:'acme',occurredAt:'2026-10-24T15:00:00Z',requestId:'1',endpoint:'/search',vertical:'retail',statusCode:200,latencyMs:100,estimatedCostUsd:.01},
   {companyId:'other',occurredAt:'2026-10-24T15:00:00Z',requestId:'2',endpoint:'/search',vertical:'retail',statusCode:500,latencyMs:999,estimatedCostUsd:99}
  ],
  adEvents:[
   {companyId:'acme',occurredAt:'2026-10-24T15:00:00Z',campaignId:'c1',vertical:'retail',stage:'IMPRESSION',spendUsd:10},
   {companyId:'acme',occurredAt:'2026-10-24T15:01:00Z',campaignId:'c1',vertical:'retail',stage:'CLICK'},
   {companyId:'acme',occurredAt:'2026-10-24T15:02:00Z',campaignId:'c1',vertical:'retail',stage:'MUSE_OPEN'},
   {companyId:'acme',occurredAt:'2026-10-24T15:03:00Z',campaignId:'c1',vertical:'retail',stage:'PURCHASE',revenueUsd:50}
  ]
 });
 assert.equal(report.api.calls,1);
 assert.equal(report.ads.purchases,1);
 assert.equal(report.ads.roas,5);
 assert.equal(report.verticals[0].vertical,'retail');
});

test('stale metrics cannot be represented as current',()=>{
 const status=effectiveMetricStatus({
  metricId:'roas',definitionVersion:'1',displayName:'ROAS',value:2,unit:'ratio',definition:'x',
  sourceId:'ads',sourceVersion:'v1',computedAt:'2026-10-20T00:00:00Z',freshnessSlaHours:24,
  status:'verified',codeVersion:'abc',inputHash:'hash'
 },new Date('2026-10-24T00:00:00Z'));
 assert.equal(status,'stale');
});
