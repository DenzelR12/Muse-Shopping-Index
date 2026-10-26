import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProviderReadinessManifest,deriveProviderReadinessEvidence,type ProviderVerificationEvidence} from '../dist/provider-readiness.js';

const baseConnection={
  companyId:'org-a',
  provider:'walmart',
  externalAccountId:'seller-1',
  grantedCapabilities:['catalog.read','inventory.read','pricing.read','order.create','fulfillment.read']
};

// Server-recorded Meta verification evidence (a test record, not a live
// Meta verification). No expiresAt, so it stays valid after its 2026
// verifiedAt; expired/future variants below use fixed far-past/far-future
// dates so the assertions hold whenever the suite runs.
const metaVerification={
  verified:true,
  verifiedAt:'2026-10-24T13:00:00.000Z',
  evidenceRef:'meta-evidence-001',
  issuer:'meta-business-record',
  source:'server-recorded'
};

test('provider readiness cannot advance without verified evidence',()=>{
  const manifest=buildProviderReadinessManifest({
    companyId:'org-a',
    vertical:'retail',
    integrationMode:'ZERO_CODE',
    verification:{
      connection:baseConnection,
      // Non-Meta-origin business (a Walmart commerce provider), so the
      // Meta gate does not apply and the old VERIFIED stage is expected.
      origin:'non-meta',
      identityVerified:true,
      metaBusinessVerified:true,
      catalogValidated:false,
      webhookEvents:true,
      idempotency:true,
      providerRevalidation:true,
      agentPolicyConfigured:true,
      auditTrail:true,
      recoveryActions:true,
      fulfillmentStatus:true
    }
  });
  assert.equal(manifest.readiness,'VERIFIED');
  assert.equal(manifest.capabilities.purchase,false);
});

test('provider readiness reaches transaction-ready only with required capabilities and controls',()=>{
  const manifest=buildProviderReadinessManifest({
    companyId:'org-a',
    vertical:'retail',
    integrationMode:'ZERO_CODE',
    verification:{
      connection:baseConnection,
      // Non-Meta-origin business, so Meta verification is not consulted.
      origin:'non-meta',
      identityVerified:true,
      metaBusinessVerified:true,
      catalogValidated:true,
      webhookEvents:true,
      idempotency:true,
      providerRevalidation:true,
      agentPolicyConfigured:false,
      auditTrail:false,
      recoveryActions:false,
      fulfillmentStatus:true
    }
  });
  assert.equal(manifest.readiness,'TRANSACTION_READY');
  assert.equal(manifest.capabilities.purchase,true);
  assert.equal(manifest.capabilities.trackOrder,true);
});

test('missing order capability blocks transaction readiness',()=>{
  const evidence=deriveProviderReadinessEvidence({
    connection:{...baseConnection,grantedCapabilities:['catalog.read','inventory.read','pricing.read','fulfillment.read']},
    identityVerified:true,
    catalogValidated:true,
    webhookEvents:true,
    idempotency:true,
    providerRevalidation:true,
    agentPolicyConfigured:true,
    auditTrail:true,
    recoveryActions:true,
    fulfillmentStatus:true
  });
  assert.equal(evidence.transactionAction,false);
});

test('readiness is tenant-bound',()=>{
  assert.throws(()=>buildProviderReadinessManifest({
    companyId:'org-b',
    vertical:'retail',
    integrationMode:'ZERO_CODE',
    verification:{
      connection:baseConnection,
      identityVerified:true,
      metaBusinessVerified:true,
      catalogValidated:true,
      webhookEvents:true,
      idempotency:true,
      providerRevalidation:true,
      agentPolicyConfigured:true,
      auditTrail:true,
      recoveryActions:true,
      fulfillmentStatus:true
    }
  }),/provider_readiness_company_mismatch/);
});


test('Meta business verification is required before transaction readiness',()=>{
  const manifest=buildProviderReadinessManifest({
    companyId:'org-a',
    vertical:'retail',
    integrationMode:'ZERO_CODE',
    verification:{
      connection:baseConnection,
      identityVerified:true,
      metaBusinessVerified:false,
      catalogValidated:true,
      webhookEvents:true,
      idempotency:true,
      providerRevalidation:true,
      agentPolicyConfigured:true,
      auditTrail:true,
      recoveryActions:true,
      fulfillmentStatus:true
    }
  });
  assert.equal(manifest.readiness,'CONNECTED');
  assert.equal(manifest.metaBusinessRequired,true);
  assert.equal(manifest.capabilities.purchase,false);
});

test('Meta-origin provider readiness walks the Meta ladder only with valid evidence',()=>{
  const baseVerification:ProviderVerificationEvidence={
    connection:baseConnection,
    origin:'meta',
    identityVerified:true,
    metaBusinessVerified:true,
    metaVerification,
    catalogValidated:true,
    webhookEvents:true,
    idempotency:true,
    providerRevalidation:true,
    agentPolicyConfigured:false,
    auditTrail:false,
    recoveryActions:false,
    fulfillmentStatus:true
  };
  const build=(overrides:Partial<ProviderVerificationEvidence>)=>buildProviderReadinessManifest({
    companyId:'org-a',
    vertical:'retail',
    integrationMode:'ZERO_CODE',
    verification:{...baseVerification,...overrides}
  });
  // No evidence record: a bare flag is self-attestation, not proof.
  assert.equal(build({metaVerification:undefined}).readiness,'CONNECTED');
  assert.equal(build({metaVerification:undefined}).capabilities.purchase,false);
  // Flag and evidence must agree.
  assert.equal(build({metaBusinessVerified:false}).readiness,'CONNECTED');
  // Valid evidence, catalog not yet validated.
  assert.equal(build({catalogValidated:false}).readiness,'META_VERIFIED');
  // Valid evidence, catalog validated, a transaction gate missing.
  assert.equal(build({webhookEvents:false}).readiness,'CATALOG_VERIFIED');
  // Valid evidence and every gate green.
  const ready=build({});
  assert.equal(ready.readiness,'TRANSACTION_READY');
  assert.equal(ready.metaBusinessRequired,true);
  assert.equal(ready.capabilities.purchase,true);
});

test('Meta-origin provider readiness rejects self-attested, missing and expired evidence',()=>{
  const build=(metaVerificationValue:ProviderVerificationEvidence['metaVerification'])=>buildProviderReadinessManifest({
    companyId:'org-a',
    vertical:'retail',
    integrationMode:'ZERO_CODE',
    verification:{
      connection:baseConnection,
      origin:'meta',
      identityVerified:true,
      metaBusinessVerified:true,
      metaVerification:metaVerificationValue,
      catalogValidated:true,
      webhookEvents:true,
      idempotency:true,
      providerRevalidation:true,
      agentPolicyConfigured:false,
      auditTrail:false,
      recoveryActions:false,
      fulfillmentStatus:true
    }
  });
  for(const bad of [
    {...metaVerification,source:'self-attested',issuer:'self'},
    {...metaVerification,source:'model'},
    {...metaVerification,evidenceRef:''},
    {...metaVerification,verifiedAt:'2999-01-01T00:00:00.000Z'},
    {...metaVerification,expiresAt:'2020-01-01T00:00:00.000Z'}
  ]){
    const manifest=build(bad);
    assert.equal(manifest.readiness,'CONNECTED',JSON.stringify(bad));
    assert.equal(manifest.capabilities.purchase,false);
  }
});

test('non-Meta-origin provider readiness ignores Meta verification entirely',()=>{
  const manifest=buildProviderReadinessManifest({
    companyId:'org-a',
    vertical:'retail',
    integrationMode:'ZERO_CODE',
    verification:{
      connection:baseConnection,
      origin:'non-meta',
      identityVerified:true,
      metaBusinessVerified:false,
      catalogValidated:true,
      webhookEvents:true,
      idempotency:true,
      providerRevalidation:true,
      agentPolicyConfigured:false,
      auditTrail:false,
      recoveryActions:false,
      fulfillmentStatus:true
    }
  });
  assert.equal(manifest.readiness,'TRANSACTION_READY');
  assert.equal(manifest.metaBusinessRequired,false);
  assert.equal(manifest.capabilities.purchase,true);
});
