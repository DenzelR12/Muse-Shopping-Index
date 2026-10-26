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
