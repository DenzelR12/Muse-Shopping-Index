import test from 'node:test';
import assert from 'node:assert/strict';
import {InMemoryReplayStore,issueApprovalToken} from '../../../packages/zero-trust/dist/index.js';
import {
  MemoryConnectionAuthority,
  MemoryDraftAuthority,
  ZeroTrustConnectorRegistry,
  ZeroTrustConnectorRuntime
} from '../dist/business-zero-trust.js';
import {defaultConnectorActions} from '../dist/business-connectors.js';

const manifest={companyId:'travel-co',slug:'travel-co',displayName:'Travel Co',vertical:'travel',status:'ACTIVE',actions:defaultConnectorActions};
const connection={connectionId:'conn-1',companyId:'travel-co',subjectId:'customer-1',grantedActions:['search_offers','create_action_draft','execute_action'],secretRef:'secret://server-only',createdAt:'2026-10-24T12:00:00.000Z',expiresAt:'2026-10-25T12:00:00.000Z'};

function setup(){
  const registry=new ZeroTrustConnectorRegistry();
  registry.register(manifest,{
    idempotentCommit:true,
    async search(){return [{offerId:'offer-1',title:'Trip',provider:'Travel Co',price:1800,currency:'USD',availability:'AVAILABLE',evidenceAt:'2026-10-24T13:00:00.000Z'}];},
    async createDraft({connection}){return {draftId:'draft-1',companyId:'travel-co',connectionId:connection.connectionId,kind:'BOOKING',offerIds:['offer-1'],quantity:1,total:1800,currency:'USD',summary:'Trip',createdAt:'2026-10-24T13:00:00.000Z',expiresAt:'2026-10-24T14:00:00.000Z',approvalRequired:true,liveRevalidationRequired:true};},
    async revalidate(draft){return structuredClone(draft);},
    async execute({draft}){return {executionId:'exec-1',draftId:draft.draftId,status:'CONFIRMED',providerReference:'TRIP-1',committedAt:'2026-10-24T13:10:00.000Z',message:'ok'};}
  });
  const connections=new MemoryConnectionAuthority(); connections.put(connection);
  const drafts=new MemoryDraftAuthority(); const replay=new InMemoryReplayStore();
  const runtime=new ZeroTrustConnectorRuntime(registry,connections,drafts,replay,{draftSigningSecret:'draft-secret',approvalSigningSecret:'approval-secret'});
  return {runtime,drafts};
}

test('caller only supplies opaque connection ID for search and draft',async()=>{
  const {runtime}=setup();
  const search=await runtime.search('travel-co','conn-1',{query:'trip'},new Date('2026-10-24T13:00:00Z'));
  assert.equal(search.offers.length,1);
  const created=await runtime.createDraft('travel-co','conn-1',{offerIds:['offer-1'],quantity:1,kind:'BOOKING'},new Date('2026-10-24T13:00:00Z'));
  assert.equal(created.draft.draftId,'draft-1');
  assert.equal('providerState' in created.draft,false);
});

test('exact one-time approval is required for execution',async()=>{
  const {runtime,drafts}=setup();
  await runtime.createDraft('travel-co','conn-1',{offerIds:['offer-1'],quantity:1,kind:'BOOKING'},new Date('2026-10-24T13:00:00Z'));
  const env=await drafts.get('draft-1');
  const token=issueApprovalToken({
    subjectId:'customer-1',companyId:'travel-co',connectionId:'conn-1',draftId:'draft-1',draftHash:env.payloadHash,amount:1800,currency:'USD',expiresAt:'2026-10-24T13:30:00Z'
  },'approval-secret','2026-10-24T13:05:00Z');
  const result=await runtime.execute('travel-co','conn-1',{draftId:'draft-1',approvalToken:token},new Date('2026-10-24T13:10:00Z'));
  assert.equal(result.status,'CONFIRMED');
  await assert.rejects(()=>runtime.execute('travel-co','conn-1',{draftId:'draft-1',approvalToken:token},new Date('2026-10-24T13:11:00Z')),/approval_replayed|already_executing/);
});

test('provider price change forces reapproval instead of silently committing',async()=>{
  const registry=new ZeroTrustConnectorRegistry();
  registry.register(manifest,{
    idempotentCommit:true,
    async search(){return [];},
    async createDraft({connection}){return {draftId:'d2',companyId:'travel-co',connectionId:connection.connectionId,kind:'BOOKING',offerIds:['o'],quantity:1,total:100,currency:'USD',summary:'x',createdAt:'2026-10-24T13:00:00Z',expiresAt:'2026-10-24T14:00:00Z',approvalRequired:true,liveRevalidationRequired:true};},
    async revalidate(draft){return {...draft,total:110};},
    async execute(){throw new Error('must_not_execute');}
  });
  const connections=new MemoryConnectionAuthority();connections.put(connection);
  const drafts=new MemoryDraftAuthority();
  const runtime=new ZeroTrustConnectorRuntime(registry,connections,drafts,new InMemoryReplayStore(),{draftSigningSecret:'draft-secret',approvalSigningSecret:'approval-secret'});
  await runtime.createDraft('travel-co','conn-1',{offerIds:['o'],quantity:1,kind:'BOOKING'},new Date('2026-10-24T13:00:00Z'));
  const env=await drafts.get('d2');
  const token=issueApprovalToken({subjectId:'customer-1',companyId:'travel-co',connectionId:'conn-1',draftId:'d2',draftHash:env.payloadHash,amount:100,currency:'USD',expiresAt:'2026-10-24T13:30:00Z'},'approval-secret','2026-10-24T13:05:00Z');
  await assert.rejects(()=>runtime.execute('travel-co','conn-1',{draftId:'d2',approvalToken:token},new Date('2026-10-24T13:10:00Z')),/provider_state_changed_reapproval_required/);
});
// --- Generic execution profile: SYNTHETIC DEMO ONLY fixture adapter ---
// These tests exercise the generic path through ZeroTrustConnectorRuntime
// exactly as the Muse host's submitGeneric delegates to it. The fixture is
// synthetic, never a real company, and no test here moves real money.
import {SyntheticFixtureConnectorAdapter,syntheticFixtureManifest,SYNTHETIC_FIXTURE_COMPANY_ID} from '../dist/synthetic-fixture-connector.js';

function syntheticSetup(options={}){
  const adapter=new SyntheticFixtureConnectorAdapter({now:()=>new Date('2026-10-24T13:00:00Z'),...options});
  const registry=new ZeroTrustConnectorRegistry();
  registry.register(syntheticFixtureManifest,adapter);
  const connections=new MemoryConnectionAuthority();
  const connection={connectionId:'conn-synth',companyId:SYNTHETIC_FIXTURE_COMPANY_ID,subjectId:'customer-1',grantedActions:['search_offers','create_action_draft','execute_action'],secretRef:'secret://server-only',createdAt:'2026-10-24T12:00:00.000Z',expiresAt:'2026-10-25T12:00:00.000Z'};
  connections.put(connection);
  const drafts=new MemoryDraftAuthority();
  const runtime=new ZeroTrustConnectorRuntime(registry,connections,drafts,new InMemoryReplayStore(),{draftSigningSecret:'draft-secret',approvalSigningSecret:'approval-secret'});
  return {runtime,drafts,adapter,connections,connection};
}
async function syntheticDraft(setup){
  const created=await setup.runtime.createDraft(SYNTHETIC_FIXTURE_COMPANY_ID,'conn-synth',{offerIds:['synthetic-booking-1'],quantity:1,kind:'BOOKING'},new Date('2026-10-24T13:00:00Z'));
  const env=await setup.drafts.get(created.draft.draftId);
  const token=issueApprovalToken({subjectId:'customer-1',companyId:SYNTHETIC_FIXTURE_COMPANY_ID,connectionId:'conn-synth',draftId:created.draft.draftId,draftHash:env.payloadHash,amount:120,currency:'USD',expiresAt:'2026-10-24T13:30:00Z'},'approval-secret','2026-10-24T13:05:00Z');
  return {draft:created.draft,token};
}

test('synthetic fixture booking executes through the generic runtime and stays labeled synthetic',async()=>{
  const setup=syntheticSetup();
  const search=await setup.runtime.search(SYNTHETIC_FIXTURE_COMPANY_ID,'conn-synth',{query:'booking'},new Date('2026-10-24T13:00:00Z'));
  assert.match(search.offers[0].title,/SYNTHETIC DEMO ONLY/);
  const {draft,token}=await syntheticDraft(setup);
  assert.equal(draft.total,120);
  const result=await setup.runtime.execute(SYNTHETIC_FIXTURE_COMPANY_ID,'conn-synth',{draftId:draft.draftId,approvalToken:token},new Date('2026-10-24T13:10:00Z'));
  assert.equal(result.status,'CONFIRMED');
  assert.match(result.providerReference,/SYNTHETIC-DEMO-ONLY/);
  assert.match(result.message,/SYNTHETIC DEMO ONLY/);
  assert.equal(setup.adapter.executeCallCount,1);
});

test('synthetic fixture drift forces reapproval and never commits',async()=>{
  const setup=syntheticSetup({driftTotal:130});
  const {draft,token}=await syntheticDraft(setup);
  await assert.rejects(()=>setup.runtime.execute(SYNTHETIC_FIXTURE_COMPANY_ID,'conn-synth',{draftId:draft.draftId,approvalToken:token},new Date('2026-10-24T13:10:00Z')),/provider_state_changed_reapproval_required/);
  assert.equal(setup.adapter.executeCallCount,0);
});

test('synthetic duplicate execute with a fresh approval fails on the execution claim, not a second commit',async()=>{
  const setup=syntheticSetup();
  const {draft,token}=await syntheticDraft(setup);
  const env=await setup.drafts.get(draft.draftId);
  const fresh=issueApprovalToken({subjectId:'customer-1',companyId:SYNTHETIC_FIXTURE_COMPANY_ID,connectionId:'conn-synth',draftId:draft.draftId,draftHash:env.payloadHash,amount:120,currency:'USD',expiresAt:'2026-10-24T13:30:00Z'},'approval-secret','2026-10-24T13:06:00Z');
  assert.equal((await setup.runtime.execute(SYNTHETIC_FIXTURE_COMPANY_ID,'conn-synth',{draftId:draft.draftId,approvalToken:token},new Date('2026-10-24T13:10:00Z'))).status,'CONFIRMED');
  await assert.rejects(()=>setup.runtime.execute(SYNTHETIC_FIXTURE_COMPANY_ID,'conn-synth',{draftId:draft.draftId,approvalToken:fresh},new Date('2026-10-24T13:11:00Z')),/draft_already_executing_or_executed/);
  assert.equal(setup.adapter.executeCallCount,1);
});

test('synthetic replayed approval JTI is rejected',async()=>{
  const setup=syntheticSetup();
  const {draft,token}=await syntheticDraft(setup);
  assert.equal((await setup.runtime.execute(SYNTHETIC_FIXTURE_COMPANY_ID,'conn-synth',{draftId:draft.draftId,approvalToken:token},new Date('2026-10-24T13:10:00Z'))).status,'CONFIRMED');
  await assert.rejects(()=>setup.runtime.execute(SYNTHETIC_FIXTURE_COMPANY_ID,'conn-synth',{draftId:draft.draftId,approvalToken:token},new Date('2026-10-24T13:11:00Z')),/approval_replayed/);
  assert.equal(setup.adapter.executeCallCount,1);
});

test('synthetic cross-company and cross-connection executes are rejected before any commit',async()=>{
  const setup=syntheticSetup();
  const {draft,token}=await syntheticDraft(setup);
  await assert.rejects(()=>setup.runtime.execute('travel-co','conn-synth',{draftId:draft.draftId,approvalToken:token},new Date('2026-10-24T13:10:00Z')),/connection_company_mismatch/);
  setup.connections.put({...setup.connection,connectionId:'conn-synth-2'});
  await assert.rejects(()=>setup.runtime.execute(SYNTHETIC_FIXTURE_COMPANY_ID,'conn-synth-2',{draftId:draft.draftId,approvalToken:token},new Date('2026-10-24T13:10:00Z')),/draft_scope_mismatch/);
  assert.equal(setup.adapter.executeCallCount,0);
});

test('synthetic expired draft and cancelled (revoked) connection commit nothing',async()=>{
  const expired=syntheticSetup();
  const {draft,token}=await syntheticDraft(expired);
  await assert.rejects(()=>expired.runtime.execute(SYNTHETIC_FIXTURE_COMPANY_ID,'conn-synth',{draftId:draft.draftId,approvalToken:token},new Date('2026-10-24T15:00:00Z')),/draft_expired/);
  assert.equal(expired.adapter.executeCallCount,0);
  const cancelled=syntheticSetup();
  const made=await syntheticDraft(cancelled);
  cancelled.connections.put({...cancelled.connection,revokedAt:'2026-10-24T13:05:00.000Z'});
  await assert.rejects(()=>cancelled.runtime.execute(SYNTHETIC_FIXTURE_COMPANY_ID,'conn-synth',{draftId:made.draft.draftId,approvalToken:made.token},new Date('2026-10-24T13:10:00Z')),/revoked/);
  assert.equal(cancelled.adapter.executeCallCount,0);
});

test('synthetic uncertain execution throws the reconciliation marker and the adapter commit is idempotent',async()=>{
  const setup=syntheticSetup({uncertain:true});
  const {draft,token}=await syntheticDraft(setup);
  await assert.rejects(()=>setup.runtime.execute(SYNTHETIC_FIXTURE_COMPANY_ID,'conn-synth',{draftId:draft.draftId,approvalToken:token},new Date('2026-10-24T13:10:00Z')),/execution_uncertain_reconciliation_required/);
  const direct=syntheticSetup();
  const made=await syntheticDraft(direct);
  const approval={approved:true,approvedAt:'2026-10-24T13:10:00Z',approvalId:'synthetic-approval-1'};
  const first=await direct.adapter.execute({draft:{...made.draft,companyId:SYNTHETIC_FIXTURE_COMPANY_ID,connectionId:'conn-synth'},connection:direct.connection,approval});
  const second=await direct.adapter.execute({draft:{...made.draft,companyId:SYNTHETIC_FIXTURE_COMPANY_ID,connectionId:'conn-synth'},connection:direct.connection,approval});
  assert.equal(first.executionId,second.executionId);
  assert.equal(first.status,'CONFIRMED');
});
