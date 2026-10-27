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

// --- Meta catalog client gates (CI-listed copy) --------------------------
// .github/workflows/ci.yml is frozen in the change that added the Meta
// catalog client, so the fail-closed gates live here, in a file CI
// already runs. The full suite is apps/api/test/meta-catalog.test.ts
// (mocked Graph API transport only); these gates mirror its
// fail-closed cases and must stay in agreement with it.
import {
  createMetaCatalogGraphTransport,
  readMetaCatalog,
  type MetaCatalogClient,
} from '../src/meta-catalog.js';

const metaCatalogConfigOn = {baseUrl: 'https://graph.facebook.com', version: 'v26.0', tokenConfigured: true};
const metaCatalogConfigOff = {baseUrl: 'https://graph.facebook.com', version: 'v26.0', tokenConfigured: false};
const metaCatalogMockClient: MetaCatalogClient = {
  fetchCatalog: async () => ({name: 'Test Catalog'}),
  fetchProducts: async () => ({data: []}),
};

test('Meta catalog read fails closed without a token, with no network call', async () => {
  let calls = 0;
  const counting: MetaCatalogClient = {
    fetchCatalog: async () => { calls++; return {}; },
    fetchProducts: async () => { calls++; return {data: []}; },
  };
  await assert.rejects(
    readMetaCatalog({config: metaCatalogConfigOff, client: counting, companyId: 'org-a', principalCompanyId: 'org-a', catalogId: 'catalog-1', now: '2026-10-27T12:00:00.000Z'}),
    /muse_catalog_not_configured/,
  );
  assert.equal(calls, 0);
});

test('Meta catalog read fails closed without a startup-registered client, and on tenant mismatch or missing catalog ID', async () => {
  await assert.rejects(
    readMetaCatalog({config: metaCatalogConfigOn, client: null, companyId: 'org-a', principalCompanyId: 'org-a', catalogId: 'catalog-1', now: '2026-10-27T12:00:00.000Z'}),
    /muse_catalog_client_not_registered/,
  );
  await assert.rejects(
    readMetaCatalog({config: metaCatalogConfigOn, client: metaCatalogMockClient, companyId: 'org-a', principalCompanyId: 'org-b', catalogId: 'catalog-1', now: '2026-10-27T12:00:00.000Z'}),
    /provider_readiness_company_mismatch/,
  );
  await assert.rejects(
    readMetaCatalog({config: metaCatalogConfigOn, client: metaCatalogMockClient, companyId: 'org-a', principalCompanyId: 'org-a', catalogId: null, now: '2026-10-27T12:00:00.000Z'}),
    /muse_catalog_id_not_configured/,
  );
});

test('Meta catalog client exposes GET only, by construction', async () => {
  const methods: string[] = [];
  const transport = createMetaCatalogGraphTransport({
    baseUrl: 'https://graph.facebook.com',
    version: 'v26.0',
    token: 'test-token-not-real',
    fetchImpl: async (url, init) => {
      methods.push(init.method);
      return {ok: true, status: 200, json: async () => (url.endsWith('/products') ? {data: []} : {name: 'Test Catalog'})};
    },
  });
  assert.deepEqual(Object.keys(transport), ['get']);
  const result = await readMetaCatalog({config: metaCatalogConfigOn, client: {fetchCatalog: async () => transport.get('https://graph.facebook.com/v26.0/catalog-1'), fetchProducts: async () => transport.get('https://graph.facebook.com/v26.0/catalog-1/products')}, companyId: 'org-a', principalCompanyId: 'org-a', catalogId: 'catalog-1', now: '2026-10-27T12:00:00.000Z'});
  assert.deepEqual(methods, ['GET', 'GET']);
  assert.equal(result.source, 'META CATALOG');
});

// Muse reminder gates (full suite is apps/api/test/muse-reminder.test.ts,
// mocked channel transport only); these gates mirror its fail-closed
// cases and must stay in agreement with it.
import {
  MemoryMuseReminderStore,
  optInToReminder,
  sendMuseReminder,
} from '../src/muse-reminder.js';

test('Muse reminder sends nothing without opt-in, and is blocked without a registered channel', async () => {
  const store = new MemoryMuseReminderStore();
  const calls: unknown[] = [];
  const channel = {send: async (payload: unknown) => { calls.push(payload); }};
  const draft = {draftId: 'draft-1', consumerSubject: 'consumer-1', companyId: 'company-1', expiresAt: '2026-10-28T12:00:00.000Z', approved: false, executed: false};
  await assert.rejects(
    sendMuseReminder({store, channel, principalSubject: 'consumer-1', principalCompanyId: 'company-1', draft, now: '2026-10-27T12:00:00.000Z'}),
    /muse_reminder_not_opted_in/,
  );
  await optInToReminder({store, principalSubject: 'consumer-1', principalCompanyId: 'company-1', companyId: 'company-1', draftId: 'draft-1', now: '2026-10-27T12:00:00.000Z'});
  await assert.rejects(
    sendMuseReminder({store, channel: null, principalSubject: 'consumer-1', principalCompanyId: 'company-1', draft, now: '2026-10-27T12:00:00.000Z'}),
    /muse_reminder_channel_not_registered/,
  );
  assert.equal(calls.length, 0);
});

test('Muse reminder refuses a tenant mismatch with no send', async () => {
  const store = new MemoryMuseReminderStore();
  const calls: unknown[] = [];
  const channel = {send: async (payload: unknown) => { calls.push(payload); }};
  await assert.rejects(
    optInToReminder({store, principalSubject: 'consumer-1', principalCompanyId: 'company-1', companyId: 'company-2', draftId: 'draft-1', now: '2026-10-27T12:00:00.000Z'}),
    /provider_readiness_company_mismatch/,
  );
  assert.equal(calls.length, 0);
});
