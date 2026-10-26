import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConnectorRegistry,
  ConnectorRuntime,
  assertBusinessTransactionReady,
  buildBusinessCapabilityManifest,
  clickReduction,
  defaultConnectorActions,
  deriveBusinessReadiness,
  isMetaBusinessOrigin,
  validateConnection,
  validateMetaBusinessVerification
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

// Server-recorded Meta verification evidence for the default (Meta-origin,
// because origin is omitted and omission fails closed) fixture below. This
// is a test record, not a live Meta verification.
const metaVerification={
  verified:true,
  verifiedAt:'2026-10-24T13:00:00.000Z',
  evidenceRef:'meta-evidence-001',
  issuer:'meta-business-record',
  source:'server-recorded'
};

const readinessBase={
  connectorConfigured:true,
  identityVerified:true,
  metaBusinessVerified:true,
  metaVerification,
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
  // Meta-origin ladder: catalog validated but a transaction gate missing
  // lands on CATALOG_VERIFIED, not the non-Meta VERIFIED stage.
  assert.equal(deriveBusinessReadiness({...readinessBase,livePricing:false}),'CATALOG_VERIFIED');
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

const gateNow=new Date('2026-10-26T00:00:00.000Z');

test('Meta-origin business without verification evidence cannot reach TRANSACTION_READY',()=>{
  // No evidence record at all, even with every other gate green.
  assert.equal(deriveBusinessReadiness({...readinessBase,metaVerification:undefined},gateNow),'CONNECTED');
  // A bare flag without an evidence record is self-attestation, not proof.
  assert.equal(deriveBusinessReadiness({...readinessBase,metaVerification:undefined},gateNow),'CONNECTED');
  assert.throws(()=>assertBusinessTransactionReady({...readinessBase,metaVerification:undefined},gateNow),/meta_business_verification_required/);
  // A valid evidence record without the flag also fails closed.
  assert.equal(deriveBusinessReadiness({...readinessBase,metaBusinessVerified:false},gateNow),'CONNECTED');
});

test('Meta-origin business walks META_VERIFIED to CATALOG_VERIFIED to TRANSACTION_READY',()=>{
  assert.equal(deriveBusinessReadiness({...readinessBase,catalogValidated:false},gateNow),'META_VERIFIED');
  assert.equal(deriveBusinessReadiness({...readinessBase,livePricing:false},gateNow),'CATALOG_VERIFIED');
  assert.equal(deriveBusinessReadiness(readinessBase,gateNow),'TRANSACTION_READY');
  assert.equal(deriveBusinessReadiness({
    ...readinessBase,
    agentPolicyConfigured:true,
    recoveryActions:true,
    fulfillmentStatus:true
  },gateNow),'AUTONOMOUS_READY');
  assert.equal(assertBusinessTransactionReady(readinessBase,gateNow),'TRANSACTION_READY');
});

test('non-Meta-origin business keeps its existing path and ignores Meta verification',()=>{
  const nonMeta={...readinessBase,origin:'non-meta',metaBusinessVerified:false,metaVerification:undefined};
  assert.equal(isMetaBusinessOrigin(nonMeta),false);
  assert.equal(deriveBusinessReadiness(nonMeta,gateNow),'TRANSACTION_READY');
  assert.equal(deriveBusinessReadiness({...nonMeta,catalogValidated:false},gateNow),'VERIFIED');
  assert.equal(assertBusinessTransactionReady(nonMeta,gateNow),'TRANSACTION_READY');
  const capability=buildBusinessCapabilityManifest({
    companyId:'travel-co',
    vertical:'travel',
    integrationMode:'ZERO_CODE',
    evidence:nonMeta,
    capabilities:{purchase:true},
    now:gateNow
  });
  assert.equal(capability.metaBusinessRequired,false);
  assert.equal(capability.capabilities.purchase,true);
  // An omitted origin fails closed to the Meta path, never to the non-Meta path.
  assert.equal(isMetaBusinessOrigin(readinessBase),true);
});

test('self-attested, missing, placeholder, expired and invalid Meta evidence is rejected',()=>{
  const rejected=[
    {...metaVerification,source:'self-attested',issuer:'self'},
    {...metaVerification,issuer:'self'},
    {...metaVerification,source:'model'},
    {...metaVerification,source:'browser'},
    {...metaVerification,evidenceRef:''},
    {...metaVerification,evidenceRef:'pending'},
    {...metaVerification,verified:false},
    {...metaVerification,verifiedAt:'not-a-date'},
    {...metaVerification,verifiedAt:'2026-10-27T00:00:00.000Z'},
    {...metaVerification,expiresAt:'2026-10-25T00:00:00.000Z'}
  ];
  for(const evidence of rejected){
    assert.equal(validateMetaBusinessVerification(evidence,gateNow).valid,false,JSON.stringify(evidence));
    assert.equal(deriveBusinessReadiness({...readinessBase,metaVerification:evidence},gateNow),'CONNECTED');
    assert.throws(()=>assertBusinessTransactionReady({...readinessBase,metaVerification:evidence},gateNow),/meta_business_verification_required/);
  }
  assert.equal(validateMetaBusinessVerification(metaVerification,gateNow).valid,true);
  assert.equal(validateMetaBusinessVerification({...metaVerification,source:'self-attested'},gateNow).reason,'meta_verification_source_not_accepted');
  assert.equal(validateMetaBusinessVerification({...metaVerification,expiresAt:'2026-10-25T00:00:00.000Z'},gateNow).reason,'meta_verification_expired');
});

test('transaction gate distinguishes missing Meta verification from other unmet gates',()=>{
  // Valid Meta evidence but catalog not validated: not a Meta failure.
  assert.throws(()=>assertBusinessTransactionReady({...readinessBase,catalogValidated:false},gateNow),/business_not_transaction_ready/);
  // Non-Meta business short of transaction gates: same generic error.
  assert.throws(()=>assertBusinessTransactionReady({...readinessBase,origin:'non-meta',metaBusinessVerified:false,metaVerification:undefined,livePricing:false},gateNow),/business_not_transaction_ready/);
});
