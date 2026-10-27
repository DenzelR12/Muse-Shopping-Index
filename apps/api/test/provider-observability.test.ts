import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresProviderObservabilityStore} from '../dist/provider-observability.js';

function fakePool(input:{
  states?:Array<{state:string;count:number}>;
  pending?:number;
  oldestAgeMinutes?:number|null;
  refundPending?:number;
  refundOldestAgeMinutes?:number|null;
  lastHour?:number;
  last24Hours?:number;
}={}){
  const inserts:any[]=[];
  return {
    inserts,
    async query(sql:string,params:any[]=[]){
      if(sql.includes('CREATE TABLE')||sql.includes('CREATE INDEX')) return {rows:[],rowCount:0};
      if(sql.includes('INSERT INTO provider_operational_events')){
        inserts.push(params);
        return {rows:[],rowCount:1};
      }
      if(sql.includes('GROUP BY state')){
        return {rows:(input.states??[]).map(row=>({state:row.state,count:row.count})),rowCount:(input.states??[]).length};
      }
      if(sql.includes("state='RECONCILE_REQUIRED'")){
        return {rows:[{pending:input.pending??0,oldest_age_minutes:input.oldestAgeMinutes??null}],rowCount:1};
      }
      if(sql.includes("state IN ('REFUND_REQUIRED','REFUND_EXECUTING','REFUND_SUBMITTED')")){
        return {rows:[{pending:input.refundPending??0,oldest_age_minutes:input.refundOldestAgeMinutes??null}],rowCount:1};
      }
      if(sql.includes("event_type='webhook.failed'")){
        return {rows:[{last_hour:input.lastHour??0,last_24_hours:input.last24Hours??0}],rowCount:1};
      }
      throw new Error('unexpected_query:'+sql);
    }
  };
}

test('provider observability reports healthy tenant state',async()=>{
  const pool=fakePool({
    states:[{state:'ORDER_CREATED',count:4}],
    pending:0,
    oldestAgeMinutes:null,
    lastHour:0,
    last24Hours:1
  });
  const store=new PostgresProviderObservabilityStore(pool as any,{});
  const summary=await store.summary('org-a');
  assert.equal(summary.level,'OK');
  assert.equal(summary.reconciliation.pending,0);
  assert.equal(summary.compensation.pendingRefunds,0);
  assert.equal(summary.transactions.ORDER_CREATED,4);
  assert.deepEqual(summary.alerts,[]);
});

test('reconciliation backlog and webhook failures escalate deterministically',async()=>{
  const warningPool=fakePool({pending:1,oldestAgeMinutes:35,lastHour:3,last24Hours:3});
  const warningStore=new PostgresProviderObservabilityStore(warningPool as any,{});
  const warning=await warningStore.summary('org-a');
  assert.equal(warning.level,'WARN');
  assert.ok(warning.alerts.includes('reconciliation_backlog_warning'));
  assert.ok(warning.alerts.includes('reconciliation_age_warning'));
  assert.ok(warning.alerts.includes('webhook_failures_warning'));

  const criticalPool=fakePool({pending:5,oldestAgeMinutes:130,lastHour:10,last24Hours:10});
  const criticalStore=new PostgresProviderObservabilityStore(criticalPool as any,{});
  const critical=await criticalStore.summary('org-a');
  assert.equal(critical.level,'CRITICAL');
  assert.ok(critical.alerts.includes('reconciliation_backlog_critical'));
  assert.ok(critical.alerts.includes('reconciliation_age_critical'));
  assert.ok(critical.alerts.includes('webhook_failures_critical'));
});

test('thresholds are configurable without permitting invalid values',async()=>{
  const pool=fakePool({pending:2,oldestAgeMinutes:15,lastHour:1});
  const store=new PostgresProviderObservabilityStore(pool as any,{
    PROVIDER_RECONCILE_WARN:'2',
    PROVIDER_RECONCILE_CRITICAL:'9',
    PROVIDER_RECONCILE_AGE_WARN_MINUTES:'10',
    PROVIDER_RECONCILE_AGE_CRITICAL_MINUTES:'90',
    PROVIDER_WEBHOOK_FAILURE_WARN:'1',
    PROVIDER_WEBHOOK_FAILURE_CRITICAL:'8'
  });
  const summary=await store.summary('org-a');
  assert.equal(summary.level,'WARN');
  assert.equal(summary.thresholds.reconcileWarn,2);
  assert.equal(summary.thresholds.webhookFailureWarn,1);
});

test('operational event recording sanitizes unsafe error codes',async()=>{
  const pool=fakePool();
  const store=new PostgresProviderObservabilityStore(pool as any,{});
  await store.record({provider:'stripe',eventType:'webhook.failed',errorCode:'Bearer secret value'});
  assert.equal(pool.inserts.length,1);
  assert.equal(pool.inserts[0][1],'stripe');
  assert.equal(pool.inserts[0][2],'webhook.failed');
  assert.equal(pool.inserts[0][3],'provider_operational_error');
});


test('any refund compensation backlog is critical customer-impacting health',async()=>{
  const pool=fakePool({
    states:[{state:'REFUND_REQUIRED',count:1}],
    refundPending:1,
    refundOldestAgeMinutes:4,
    lastHour:0,
    last24Hours:0
  });
  const store=new PostgresProviderObservabilityStore(pool as any,{});
  const summary=await store.summary('org-a');
  assert.equal(summary.level,'CRITICAL');
  assert.equal(summary.compensation.pendingRefunds,1);
  assert.ok(summary.alerts.includes('refund_compensation_required'));
});

// --- Muse BI secondary demo (AdJudge guardrails) ---
// Appended here (not a new file) so CI's existing
// apps/api/test/provider-observability.test.ts run covers BI.
// All BI data below is supplied/demo; nothing here is live data.
import {
  ATTRIBUTION_WINDOW_DAYS,
  InMemoryBiEventStore,
  applyBiIngestionResult,
  assertVerifiedForCurrentClaim,
  attributeBiOutcomes,
  biStatusLabel,
  buildBiCsv,
  buildBiDashboardHtml,
  buildBiForensicsTimeline,
  computeBiInputHash,
  evaluateBiVerification,
  parseSuppliedBiEvents,
  proposeBiHypothesis,
  proposeReconcileRemediation,
  queryBiCurrentClaim,
  queryBiReport,
  recordBiFunnelEvent,
} from '../dist/muse-bi.js';
import {PostgresBiEventStore} from '../dist/muse-bi-store.js';

const biEvents=()=>parseSuppliedBiEvents([
  {companyId:'org-a',draftId:'draft-1',campaignId:'camp-1',reelId:'reel-1',stage:'intent',occurredAt:'2026-10-20T00:00:00Z'},
  {companyId:'org-a',draftId:'draft-1',campaignId:'camp-1',reelId:'reel-1',stage:'review',occurredAt:'2026-10-20T01:00:00Z'},
  {companyId:'org-a',draftId:'draft-1',campaignId:'camp-1',reelId:'reel-1',stage:'approval',occurredAt:'2026-10-20T02:00:00Z',approvalJti:'jti-1',approvalHash:'h'.repeat(64)},
  {companyId:'org-a',draftId:'draft-1',campaignId:'camp-1',reelId:'reel-1',stage:'transaction',occurredAt:'2026-10-20T03:00:00Z',transactionRef:'txn-1'},
  {companyId:'org-a',draftId:'draft-1',campaignId:'camp-1',reelId:'reel-1',stage:'verified_outcome',occurredAt:'2026-10-21T00:00:00Z',amount:100,currency:'USD',orderRef:'ord-1',outcomeRef:'out-1'},
  // Duplicate outcome for the same draft: attributed once only.
  {companyId:'org-a',draftId:'draft-1',campaignId:'camp-1',reelId:'reel-1',stage:'verified_outcome',occurredAt:'2026-10-22T00:00:00Z',amount:100,currency:'USD',outcomeRef:'out-2'},
  // Other tenant: must never leak into org-a aggregation.
  {companyId:'org-b',draftId:'draft-9',stage:'intent',occurredAt:'2026-10-20T00:00:00Z'},
  {companyId:'org-b',draftId:'draft-9',stage:'verified_outcome',occurredAt:'2026-10-21T00:00:00Z',amount:9999,currency:'USD'},
  // Organic draft (no campaign): refund adjusts revenue.
  {companyId:'org-a',draftId:'draft-2',stage:'intent',occurredAt:'2026-10-20T00:00:00Z'},
  {companyId:'org-a',draftId:'draft-2',stage:'verified_outcome',occurredAt:'2026-10-21T00:00:00Z',amount:50,currency:'USD',refundAmount:10},
]);

test('BI verification contract: verified passes, stale and unverifiable are blocked from current claims, tampered hash is unverifiable',()=>{
  assert.equal(ATTRIBUTION_WINDOW_DAYS,30);
  const now=new Date('2026-10-26T00:00:00Z');
  const verified=evaluateBiVerification({computedAt:'2026-10-26T00:00:00Z',now,freshnessSlaMs:86400000,sourceValid:true,actualInputHash:'abc'});
  assert.equal(verified,'verified');
  assert.equal(biStatusLabel(verified),'current');
  const stale=evaluateBiVerification({computedAt:'2026-10-20T00:00:00Z',now,freshnessSlaMs:86400000,sourceValid:true,actualInputHash:'abc'});
  assert.equal(stale,'stale');
  assert.equal(biStatusLabel(stale),'stale');
  assert.throws(()=>assertVerifiedForCurrentClaim({verificationStatus:'stale'} as any),/bi_metric_stale/);
  assert.throws(()=>assertVerifiedForCurrentClaim({verificationStatus:'unverifiable'} as any),/bi_metric_unverifiable/);
  const tampered=evaluateBiVerification({computedAt:'2026-10-26T00:00:00Z',now,freshnessSlaMs:86400000,sourceValid:true,expectedInputHash:'abc',actualInputHash:'def'});
  assert.equal(tampered,'unverifiable');
  assert.equal(computeBiInputHash({b:1,a:2}),computeBiInputHash({a:2,b:1}));
});

test('BI tenant trimming happens before aggregation and unknown metrics/dimensions are rejected',()=>{
  const events=biEvents();
  const report=queryBiReport({principalCompanyId:'org-a',metric:'attributed_revenue',events,computedAt:'2026-10-26T00:00:00Z',now:new Date('2026-10-26T00:00:00Z')});
  // org-a: draft-1 attributed 100 (duplicate ignored) + draft-2 50-10 = 140. org-b 9999 must not appear.
  assert.equal((report.data as any).attributedRevenue,140);
  assert.equal(report.dataSourceLabel,'DEMO/SUPPLIED EVENTS');
  assert.equal(report.tenantFilteredBeforeAggregation,true);
  assert.equal(report.provenance.verificationStatus,'verified');
  assert.equal(report.provenance.definitionName,'attributed_revenue');
  assert.ok(report.provenance.inputHash.length===64);
  assert.throws(()=>queryBiReport({principalCompanyId:'org-a',attemptedCompanyId:'org-b',metric:'attributed_revenue',events}),/bi_tenant_mismatch/);
  assert.throws(()=>queryBiReport({principalCompanyId:'',metric:'attributed_revenue',events}),/bi_principal_required/);
  assert.throws(()=>queryBiReport({principalCompanyId:'org-a',metric:'creative_quality',events}),/bi_metric_not_approved/);
  assert.throws(()=>queryBiReport({principalCompanyId:'org-a',metric:'funnel_counts',dimensions:['creativeLabel'],events}),/bi_dimension_not_approved/);
  const current=queryBiCurrentClaim({principalCompanyId:'org-a',metric:'verified_orders',events,computedAt:'2026-10-26T00:00:00Z',now:new Date('2026-10-26T00:00:00Z')});
  assert.equal((current.data as any).verifiedOutcomeCount,2);
  const staleReport=queryBiReport({principalCompanyId:'org-a',metric:'verified_orders',events,computedAt:'2026-10-20T00:00:00Z',now:new Date('2026-10-26T00:00:00Z')});
  assert.equal(staleReport.provenance.verificationStatus,'stale');
  assert.throws(()=>queryBiCurrentClaim({principalCompanyId:'org-a',metric:'verified_orders',events,computedAt:'2026-10-20T00:00:00Z',now:new Date('2026-10-26T00:00:00Z')}),/bi_metric_stale/);
});

test('BI funnel: acquisition set at creation, attribution once per draft within 30 days, ROAS unverifiable without spend',()=>{
  const paid=recordBiFunnelEvent({companyId:'org-a',draftId:'d',campaignId:'c',stage:'intent',occurredAt:'2026-10-20T00:00:00Z'});
  assert.equal(paid.acquisition,'paid');
  const organic=recordBiFunnelEvent({companyId:'org-a',draftId:'d',stage:'intent',occurredAt:'2026-10-20T00:00:00Z'});
  assert.equal(organic.acquisition,'organic');
  assert.throws(()=>recordBiFunnelEvent({companyId:'org-a',draftId:'d',stage:'intent',occurredAt:'2026-10-20T00:00:00Z',acquisition:'paid'}),/bi_supplied_acquisition_mismatch/);
  // attributeBiOutcomes itself is tenant-agnostic; the query layer trims
  // before calling it, so attribute the trimmed org-a set here.
  const attributed=attributeBiOutcomes(biEvents().filter(event=>event.companyId==='org-a'));
  assert.equal(attributed.filter(item=>item.attributed).length,2);
  assert.equal(attributed.find(item=>item.event.outcomeRef==='out-2')?.reason,'duplicate_outcome_for_draft');
  const late=attributeBiOutcomes(parseSuppliedBiEvents([
    {companyId:'org-a',draftId:'d-late',stage:'intent',occurredAt:'2026-09-01T00:00:00Z'},
    {companyId:'org-a',draftId:'d-late',stage:'verified_outcome',occurredAt:'2026-10-26T00:00:00Z',amount:10,currency:'USD'},
  ]));
  assert.equal(late[0]?.reason,'outside_attribution_window');
  const roas=queryBiReport({principalCompanyId:'org-a',metric:'roas',events:biEvents(),computedAt:'2026-10-26T00:00:00Z',now:new Date('2026-10-26T00:00:00Z')});
  assert.equal(roas.provenance.verificationStatus,'unverifiable');
  assert.equal((roas.data as any).roas,null);
  const roasWithSpend=queryBiReport({principalCompanyId:'org-a',metric:'roas',events:biEvents(),spendByCampaign:{'camp-1':50},computedAt:'2026-10-26T00:00:00Z',now:new Date('2026-10-26T00:00:00Z')});
  assert.equal(roasWithSpend.provenance.verificationStatus,'verified');
  assert.equal((roasWithSpend.data as any).roas,2);
});

test('BI watermark does not advance on ingestion failure and retains the last verified artifact',async()=>{
  const store=new InMemoryBiEventStore();
  const failedFirst=await applyBiIngestionResult({store,metric:'attributed_revenue',companyId:'org-a',ok:false});
  assert.equal(failedFirst.advanced,false);
  assert.equal(failedFirst.status,'unverifiable');
  const ok=await applyBiIngestionResult({store,metric:'attributed_revenue',companyId:'org-a',ok:true,computedAt:'2026-10-26T00:00:00Z',inputHash:'abc',artifactId:'art-1'});
  assert.equal(ok.advanced,true);
  const failedLater=await applyBiIngestionResult({store,metric:'attributed_revenue',companyId:'org-a',ok:false});
  assert.equal(failedLater.advanced,false);
  assert.equal(failedLater.status,'stale');
  assert.equal(failedLater.retained?.artifactId,'art-1');
  assert.equal(failedLater.retained?.inputHash,'abc');
});

test('BI forensics timeline is keyed by draftId with evidence refs, hypotheses are labeled, remediation is a proposal only',()=>{
  const events=biEvents();
  const timeline=buildBiForensicsTimeline({companyId:'org-a',draftId:'draft-1',events,transactionState:'RECONCILE_REQUIRED'});
  assert.equal(timeline.entries.length,6);
  assert.deepEqual(timeline.entries.map(entry=>entry.step),['intent','review','approval','execution','outcome','outcome']);
  assert.equal(timeline.entries[2]?.evidence.approvalJti,'jti-1');
  assert.equal(timeline.entries[3]?.evidence.transactionRef,'txn-1');
  assert.ok(!timeline.entries.some(entry=>entry.evidence.draftId!=='draft-1'));
  const hypothesis=proposeBiHypothesis({label:'Outcome delay may relate to review timing',evidence:['draft-1 approval at 2026-10-20T02:00:00Z','draft-1 outcome at 2026-10-21T00:00:00Z']});
  assert.equal(hypothesis.kind,'hypothesis');
  assert.equal(hypothesis.causalClaim,false);
  const proposal=proposeReconcileRemediation({draftId:'draft-1',companyId:'org-a',summary:'Manually verify provider order before any further action',risk:'Double fulfillment if the provider order already exists',rollback:'Leave transaction in RECONCILE_REQUIRED and re-open the proposal',owner:'company-operations',successCriteria:['Provider order confirmed or confirmed absent','Transaction state resolved by human action']});
  assert.equal(proposal.status,'PROPOSED_REQUIRES_HUMAN_APPROVAL');
  assert.equal(proposal.autoRetryPayment,false);
  assert.equal(proposal.execution,'human_approval_required');
  assert.throws(()=>proposeReconcileRemediation({draftId:'draft-1',companyId:'org-a',summary:'x',risk:'',rollback:'r',owner:'o',successCriteria:['s']}),/bi_remediation_risk_required/);
});

test('BI dashboard and CSV carry DEMO/SUPPLIED EVENTS labeling and provenance on every report',()=>{
  const report=queryBiReport({principalCompanyId:'org-a',metric:'funnel_counts',dimensions:['acquisition'],events:biEvents(),computedAt:'2026-10-26T00:00:00Z',now:new Date('2026-10-26T00:00:00Z')});
  const html=buildBiDashboardHtml(report);
  assert.ok(html.includes('DEMO/SUPPLIED EVENTS'));
  assert.ok(html.includes(report.provenance.inputHash));
  const csv=buildBiCsv(report);
  assert.ok(csv.includes('DEMO/SUPPLIED EVENTS'));
  assert.ok(csv.includes('verification_status,verified'));
});

test('BI Postgres store trims by company before listing and persists watermarks',async()=>{
  const rows:any[]=[];
  const watermarks=new Map<string,any>();
  const pool={
    async query(sql:string,params:any[]=[]){
      if(sql.includes('CREATE TABLE')||sql.includes('CREATE INDEX')) return {rows:[],rowCount:0};
      if(sql.includes('INSERT INTO muse_bi_events')){
        rows.push({company_id:params[0],draft_id:params[1],campaign_id:params[2],reel_id:params[3],stage:params[4],acquisition:params[5],occurred_at:new Date(params[6]),amount:params[7],currency:params[8],refund_amount:params[9],cancelled:params[10],payment_vehicle:params[11],origin:params[12],outcome_ref:params[13],transaction_ref:params[14],order_ref:params[15],approval_jti:params[16],approval_hash:params[17]});
        return {rows:[],rowCount:1};
      }
      if(sql.includes('FROM muse_bi_events WHERE company_id=$1 AND draft_id=$2')) return {rows:rows.filter(row=>row.company_id===params[0]&&row.draft_id===params[1]),rowCount:1};
      if(sql.includes('FROM muse_bi_events WHERE company_id=$1')) return {rows:rows.filter(row=>row.company_id===params[0]),rowCount:1};
      if(sql.includes('INSERT INTO muse_bi_watermarks')){
        watermarks.set(params[0]+'|'+params[1],{metric:params[0],company_id:params[1],last_verified_at:new Date(params[2]),input_hash:params[3],artifact_id:params[4]});
        return {rows:[],rowCount:1};
      }
      if(sql.includes('FROM muse_bi_watermarks')) return {rows:watermarks.has(params[0]+'|'+params[1])?[watermarks.get(params[0]+'|'+params[1])]:[],rowCount:1};
      throw new Error('unexpected_query:'+sql);
    }
  };
  const store=new PostgresBiEventStore(pool as any);
  for(const event of biEvents()) await store.record(event);
  const orgA=await store.list('org-a');
  assert.ok(orgA.length>0);
  assert.ok(orgA.every(event=>event.companyId==='org-a'));
  const draft=await store.listForDraft('org-a','draft-1');
  assert.equal(draft.length,6);
  await store.setWatermark({metric:'attributed_revenue',companyId:'org-a',lastVerifiedAt:'2026-10-26T00:00:00Z',inputHash:'abc',artifactId:'art-1'});
  assert.equal((await store.getWatermark('attributed_revenue','org-a'))?.artifactId,'art-1');
  assert.equal(await store.getWatermark('attributed_revenue','org-b'),null);
});

// --- Live activation gates (credential-gated, mocked clients) ---
// Appended here so CI's existing provider-observability run covers
// them. No real Meta, Shop Pay, or advertising credential is used:
// HMAC secrets below are test-only strings, and the ad client is
// a mock returning supplied events.
import {createHmac} from 'node:crypto';
import {
  ingestMetaAdEvents,
  parseGenericAdapterConfig,
  resolveLiveActivationConfig,
  validateMetaVerificationRecording,
  validateReelEntry,
  verifyHmacSha256Signature,
} from '../dist/live-activation.js';

const hmacFor=(secret:string,raw:Buffer)=>`sha256=${createHmac('sha256',secret).update(raw).digest('hex')}`;
const validMetaPayload=()=>Buffer.from(JSON.stringify({
  companyId:'org-a', origin:'meta', metaBusinessVerified:true,
  metaVerification:{verified:true,verifiedAt:'2026-10-20T00:00:00Z',evidenceRef:'meta-ev-1',issuer:'Meta',source:'meta-verification-webhook'},
}));

test('Live activation config reports presence only, never secret values',()=>{
  const config=resolveLiveActivationConfig({
    SHOP_PAY_EXECUTION_ENABLED:'true', SHOP_PAY_API_KEY:'test-key-not-real', SHOP_PAY_CHECKOUT_CLIENT:'operator-client-1',
    META_VERIFICATION_WEBHOOK_SECRET:'test-secret', META_ADS_ACCESS_TOKEN:'test-token', META_ADS_ACCOUNT_ID:'act_1',
    META_REEL_CALLBACK_SIGNING_SECRET:'test-secret', MUSE_GENERIC_ADAPTER_CONFIG_JSON:'{"org-a":"adapter-1"}',
  } as any);
  assert.equal(config.shopPay.ready,true);
  assert.equal(config.metaVerificationRecording.secretConfigured,true);
  assert.equal(config.metaAds.ready,true);
  assert.equal(config.reelEntry.secretConfigured,true);
  assert.deepEqual(config.genericAdapters.companyIds,['org-a']);
  assert.equal(JSON.stringify(config).includes('test-key-not-real'),false);
  assert.equal(JSON.stringify(config).includes('test-secret'),false);
  const empty=resolveLiveActivationConfig({} as any);
  assert.equal(empty.shopPay.ready,false);
  assert.equal(empty.metaAds.ready,false);
  assert.equal(empty.reelEntry.secretConfigured,false);
});

test('Meta verification recording rejects absent secret, bad signature, placeholder and expired evidence',()=>{
  const raw=validMetaPayload();
  assert.throws(()=>validateMetaVerificationRecording({secret:'',rawBody:raw,signatureHeader:hmacFor('s',raw)}),/meta_verification_recording_disabled/);
  assert.throws(()=>validateMetaVerificationRecording({secret:'s',rawBody:raw,signatureHeader:'sha256=00'}),/meta_verification_signature_invalid/);
  assert.deepEqual(validateMetaVerificationRecording({secret:'s',rawBody:raw,signatureHeader:hmacFor('s',raw)}).companyId,'org-a');
  const placeholder=Buffer.from(JSON.stringify({companyId:'org-a',metaVerification:{verified:true,verifiedAt:'2026-10-20T00:00:00Z',evidenceRef:'placeholder',issuer:'Meta',source:'meta-verification-webhook'}}));
  assert.throws(()=>validateMetaVerificationRecording({secret:'s',rawBody:placeholder,signatureHeader:hmacFor('s',placeholder)}),/meta_verification_evidence_ref_placeholder/);
  const expired=Buffer.from(JSON.stringify({companyId:'org-a',metaVerification:{verified:true,verifiedAt:'2026-10-20T00:00:00Z',evidenceRef:'meta-ev-1',issuer:'Meta',source:'meta-verification-webhook',expiresAt:'2020-01-01T00:00:00Z'}}));
  assert.throws(()=>validateMetaVerificationRecording({secret:'s',rawBody:expired,signatureHeader:hmacFor('s',expired)}),/meta_verification_expired/);
  const flagMismatch=Buffer.from(JSON.stringify({companyId:'org-a',metaBusinessVerified:false,metaVerification:{verified:true,verifiedAt:'2026-10-20T00:00:00Z',evidenceRef:'meta-ev-1',issuer:'Meta',source:'meta-verification-webhook'}}));
  assert.throws(()=>validateMetaVerificationRecording({secret:'s',rawBody:flagMismatch,signatureHeader:hmacFor('s',flagMismatch)}),/meta_verification_flag_evidence_mismatch/);
  const selfAttested=Buffer.from(JSON.stringify({companyId:'org-a',metaVerification:{verified:true,verifiedAt:'2026-10-20T00:00:00Z',evidenceRef:'meta-ev-1',issuer:'self',source:'meta-verification-webhook'}}));
  assert.throws(()=>validateMetaVerificationRecording({secret:'s',rawBody:selfAttested,signatureHeader:hmacFor('s',selfAttested)}),/meta_verification_issuer_not_accepted/);
});

test('Reel entry validates a signed intent and fails closed without a secret or with a bad signature',()=>{
  const raw=Buffer.from(JSON.stringify({reelId:'reel-9',companyId:'org-a',offerId:'offer-1'}));
  assert.throws(()=>validateReelEntry({secret:'',rawBody:raw,signatureHeader:hmacFor('s',raw)}),/reel_entry_not_configured/);
  assert.throws(()=>validateReelEntry({secret:'s',rawBody:raw,signatureHeader:'sha256=00'}),/reel_entry_signature_invalid/);
  const intent=validateReelEntry({secret:'s',rawBody:raw,signatureHeader:hmacFor('s',raw)});
  assert.equal(intent.reelId,'reel-9');
  assert.equal(intent.companyId,'org-a');
  assert.equal(verifyHmacSha256Signature({secret:'s',rawBody:raw,signatureHeader:hmacFor('s',raw)}),true);
});

test('Generic adapter config rejects the synthetic fixture and invalid JSON',()=>{
  assert.deepEqual(parseGenericAdapterConfig(undefined),{});
  assert.deepEqual(parseGenericAdapterConfig('{"org-a":"adapter-1"}'),{'org-a':'adapter-1'});
  assert.throws(()=>parseGenericAdapterConfig('{"synthetic-fixture-demo-only":"adapter-1"}'),/live_activation_generic_adapter_config_invalid/);
  assert.throws(()=>parseGenericAdapterConfig('not-json'),/live_activation_generic_adapter_config_invalid/);
});

test('Live ad ingestion trims tenants, advances the watermark on success, and does not advance it on failure',async()=>{
  const store=new InMemoryBiEventStore();
  const ok=await ingestMetaAdEvents({
    client:{async fetchEvents(){return [
      {companyId:'org-a',draftId:'draft-1',campaignId:'camp-1',stage:'intent',occurredAt:'2026-10-20T00:00:00Z'},
      {companyId:'org-a',draftId:'draft-1',campaignId:'camp-1',stage:'verified_outcome',occurredAt:'2026-10-21T00:00:00Z',amount:50,currency:'USD'},
      {companyId:'org-b',draftId:'draft-9',campaignId:'camp-9',stage:'intent',occurredAt:'2026-10-20T00:00:00Z'},
    ];}},
    companyId:'org-a', store, watermarkStore:store, computedAt:'2026-10-26T00:00:00Z',
  });
  assert.equal(ok.ok,true);
  assert.equal(ok.recorded,2);
  assert.equal(ok.droppedOtherTenant,1);
  assert.equal(ok.status,'verified');
  assert.equal((await store.list('org-a')).length,2);
  assert.equal(store.getWatermark('funnel_counts','org-a')?.artifactId,'meta-ads:org-a:2026-10-26T00:00:00Z');
  const failed=await ingestMetaAdEvents({
    client:{async fetchEvents(){throw new Error('ads_api_down');}},
    companyId:'org-a', store, watermarkStore:store, computedAt:'2026-10-27T00:00:00Z',
  });
  assert.equal(failed.ok,false);
  assert.equal(failed.status,'stale');
  assert.equal(store.getWatermark('funnel_counts','org-a')?.artifactId,'meta-ads:org-a:2026-10-26T00:00:00Z');
});
