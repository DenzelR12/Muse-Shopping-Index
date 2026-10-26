import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConnectorRegistry,
  ConnectorRuntime,
  buildBusinessCapabilityManifest,
  clickReduction,
  defaultConnectorActions,
  deriveBusinessReadiness,
  validateConnection
} from '../dist/business-connectors.js';

const manifest={
  companyId:'travel-co',
  slug:'travel-co',
  displayName:'Travel Co',
  vertical:'travel',
  status:'ACTIVE',
  actions:defaultConnectorActions
};

const connection={
  connectionId:'conn-1',
  companyId:'travel-co',
  subjectId:'customer-1',
  grantedActions:['search_offers','create_action_draft','execute_action'],
  secretRef:'secret://customer-1',
  createdAt:new Date(Date.now()-60*60*1000).toISOString(),
  expiresAt:new Date(Date.now()+24*60*60*1000).toISOString()
};

const readinessBase={
  connectorConfigured:true,
  identityVerified:true,
  metaBusinessVerified:true,
  catalogValidated:true,
  liveInventory:true,
  livePricing:true,
  transactionAction:true,
  webhookEvents:true,
  idempotency:true,
  providerRevalidation:true,
  agentPolicyConfigured:false,
  auditTrail:true,
  recoveryActions:false,
  fulfillmentStatus:false
};

test('measures click reduction without overstating it',()=>{
  assert.deepEqual(clickReduction(12,3),{
    baselineClicks:12,connectorClicks:3,removedClicks:9,reductionPercent:75
  });
});

test('blocks ungranted and expired connector actions',()=>{
  const denied=validateConnection(manifest,{...connection,grantedActions:['search_offers']},'execute_action',new Date('2026-10-24T13:00:00.000Z'));
  assert.equal(denied.allowed,false);
  const expiredConnection={...connection,expiresAt:'2026-10-24T12:00:00.000Z'};
  const expired=validateConnection(manifest,expiredConnection,'search_offers',new Date('2026-10-24T13:00:00.000Z'));
  assert.equal(expired.allowed,false);
});

test('derives business readiness from evidence instead of self-attestation',()=>{
  assert.equal(deriveBusinessReadiness({...readinessBase,identityVerified:false}),'CONNECTED');
  assert.equal(deriveBusinessReadiness({...readinessBase,metaBusinessVerified:false}),'CONNECTED');
  assert.equal(deriveBusinessReadiness({...readinessBase,livePricing:false}),'VERIFIED');
  assert.equal(deriveBusinessReadiness(readinessBase),'TRANSACTION_READY');
  assert.equal(deriveBusinessReadiness({
    ...readinessBase,
    agentPolicyConfigured:true,
    recoveryActions:true,
    fulfillmentStatus:true
  }),'AUTONOMOUS_READY');
});

test('builds a provider-neutral capability manifest and requires Meta Business verification',()=>{
  const capability=buildBusinessCapabilityManifest({
    companyId:'travel-co',
    vertical:'travel',
    integrationMode:'ZERO_CODE',
    evidence:readinessBase,
    capabilities:{reserve:true,purchase:true,cancel:true,trackOrder:true,sendGift:true},
    allowedAgents:['meta:muse','openai:chatgpt'],
    maxOrderAmount:2500,
    currency:'USD'
  });
  assert.equal(capability.readiness,'TRANSACTION_READY');
  assert.equal(capability.metaBusinessRequired,true);
  assert.equal(capability.capabilities.purchase,true);
  assert.equal(capability.capabilities.trackOrder,false);
  assert.equal(capability.agentPolicy.humanApprovalRequiredForCommit,true);
});

test('requires explicit approval before executing a provider action',async()=>{
  const registry=new ConnectorRegistry();
  registry.register(manifest,{
    async search(){return [{offerId:'offer-1',title:'Two-day park package',provider:'Travel Co',price:1800,currency:'USD',availability:'AVAILABLE',evidenceAt:'2026-10-24T13:00:00.000Z'}];},
    async createDraft({connection}){
      return {draftId:'draft-1',companyId:'travel-co',connectionId:connection.connectionId,kind:'BOOKING',offerIds:['offer-1'],quantity:1,total:1800,currency:'USD',summary:'Two-day package for four',createdAt:'2026-10-24T13:00:00.000Z',expiresAt:'2026-10-24T14:00:00.000Z',approvalRequired:true,liveRevalidationRequired:true};
    },
    async execute({draft}){return {executionId:'exec-1',draftId:draft.draftId,status:'CONFIRMED',providerReference:'TRIP-100',committedAt:'2026-10-24T13:10:00.000Z',message:'Booking confirmed'};}
  });
  const runtime=new ConnectorRuntime(registry);
  const draft=(await runtime.createDraft('travel-co',connection,{offerIds:['offer-1'],quantity:1,kind:'BOOKING'})).draft;
  await assert.rejects(()=>runtime.execute('travel-co',connection,{draft,approved:false},new Date('2026-10-24T13:05:00.000Z')),/explicit_user_approval_required/);
  const execution=await runtime.execute('travel-co',connection,{draft,approved:true,approvalId:'approval-123'},new Date('2026-10-24T13:05:00.000Z'));
  assert.equal(execution.status,'CONFIRMED');
});
