import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProviderReadinessManifest,deriveProviderReadinessEvidence} from '../dist/provider-readiness.js';

const baseConnection={
  companyId:'org-a',
  provider:'walmart',
  externalAccountId:'seller-1',
  grantedCapabilities:['catalog.read','inventory.read','pricing.read','order.create','fulfillment.read']
};

test('provider readiness cannot advance without verified evidence',()=>{
  const manifest=buildProviderReadinessManifest({
    companyId:'org-a',
    vertical:'retail',
    integrationMode:'ZERO_CODE',
    verification:{
      connection:baseConnection,
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
