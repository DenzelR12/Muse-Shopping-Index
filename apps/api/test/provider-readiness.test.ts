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

// Muse abandoned-recovery gates (full suite is
// apps/api/test/muse-abandoned-recovery.test.ts); these gates
// mirror its fail-closed resume cases and must stay in
// agreement with it.
import {
  draftExpiryWarning,
  purgeEligibleReminderRecords,
  resumeDraftDecision,
} from '../src/muse-abandoned-recovery.js';

test('Muse abandoned resume presents an owned unapproved draft and fails closed on tenant mismatch', () => {
  const principal = {subject: 'consumer-1', companyId: 'company-1'};
  const draft = {draftId: 'draft-1', companyId: 'company-1', consumerSubject: 'consumer-1', connectionId: 'conn-1', expiresAt: '2026-10-27T12:09:00.000Z', total: '277', currency: 'USD', changedSinceReview: false, approved: false};
  const decision = resumeDraftDecision({principal, draft, now: '2026-10-27T12:00:00.000Z'});
  assert.equal(decision.kind, 'present_review');
  if (decision.kind === 'present_review') {
    assert.equal(decision.approvalRequired, true);
    assert.equal(decision.executeAgain, false);
    assert.equal(decision.freshBuy, false);
  }
  assert.throws(
    () => resumeDraftDecision({principal, draft: {...draft, companyId: 'company-2'}, now: '2026-10-27T12:00:00.000Z'}),
    /provider_readiness_company_mismatch/,
  );
  assert.throws(
    () => resumeDraftDecision({principal, draft: {...draft, consumerSubject: 'consumer-2'}, now: '2026-10-27T12:00:00.000Z'}),
    /consumer_agent_not_found/,
  );
});

test('Muse abandoned resume never re-buys after approval and warns only in the final 2 minutes before expiry', () => {
  const principal = {subject: 'consumer-1', companyId: 'company-1'};
  const base = {draftId: 'draft-1', companyId: 'company-1', consumerSubject: 'consumer-1', connectionId: 'conn-1', expiresAt: '2026-10-27T12:09:00.000Z', total: '277', currency: 'USD', changedSinceReview: false, approved: false};
  const executed = resumeDraftDecision({principal, draft: {...base, approved: true, executionState: 'processing' as const}, now: '2026-10-27T12:00:00.000Z'});
  assert.equal(executed.kind, 'execution_state');
  if (executed.kind === 'execution_state') {
    assert.equal(executed.executeAgain, false);
    assert.equal(executed.freshBuy, false);
  }
  assert.equal(draftExpiryWarning({draft: base, now: '2026-10-27T12:00:00.000Z'}), null);
  const warning = draftExpiryWarning({draft: {...base, expiresAt: '2026-10-27T12:01:30.000Z'}, now: '2026-10-27T12:00:00.000Z'});
  assert.ok(warning);
  assert.match(warning?.text ?? '', /\$277 USD/);
  assert.doesNotMatch(warning?.text ?? '', /hurry/i);
  assert.deepEqual(
    purgeEligibleReminderRecords({records: [{draftId: 'd1', draftExpiresAt: '2026-10-27T11:00:00.000Z'}, {draftId: 'd2', draftExpiresAt: '2026-10-27T12:09:00.000Z'}], now: '2026-10-27T12:00:00.000Z'}).map((record) => record.draftId),
    ['d1'],
  );
});

// Shopify read-only catalog gates (full suite is
// apps/api/test/shopify-catalog.test.ts); these gates mirror
// its fail-closed cases and must stay in agreement with it.
// Storefront API query only: no cart, checkout, write, order,
// or customer endpoint is reachable through this client, and
// no live Shopify read, store, token, or seller is claimed.
import {
  readShopifyCatalog,
  resolveShopifyStoreDomain,
  type ShopifyCatalogClient,
  type ShopifyCatalogConfig,
} from '../src/shopify-catalog.js';

test('Shopify catalog read fails closed without token, client, tenant match, or store domain', async () => {
  const calls: string[] = [];
  const mockClient: ShopifyCatalogClient = {
    fetchProducts: async () => { calls.push('products'); return {products: {edges: []}}; },
    fetchProduct: async () => { calls.push('product'); return {productByHandle: null}; },
  };
  const config: ShopifyCatalogConfig = {storeDomain: 'test-store.myshopify.com', version: '2025-07', tokenConfigured: true};
  await assert.rejects(
    readShopifyCatalog({config: {...config, tokenConfigured: false}, client: mockClient, companyId: 'company-1', principalCompanyId: 'company-1', now: '2026-10-27T12:00:00.000Z'}),
    /muse_shopify_catalog_not_configured/,
  );
  await assert.rejects(
    readShopifyCatalog({config, client: null, companyId: 'company-1', principalCompanyId: 'company-1', now: '2026-10-27T12:00:00.000Z'}),
    /muse_shopify_catalog_client_not_registered/,
  );
  await assert.rejects(
    readShopifyCatalog({config, client: mockClient, companyId: 'company-1', principalCompanyId: 'company-2', now: '2026-10-27T12:00:00.000Z'}),
    /provider_readiness_company_mismatch/,
  );
  await assert.rejects(
    readShopifyCatalog({config: {...config, storeDomain: null}, client: mockClient, companyId: 'company-1', principalCompanyId: 'company-1', envStoreDomain: null, manifestStoreDomain: null, now: '2026-10-27T12:00:00.000Z'}),
    /muse_shopify_store_not_configured/,
  );
  assert.equal(calls.length, 0);
  assert.equal(resolveShopifyStoreDomain({}), null);
  assert.equal(resolveShopifyStoreDomain({envStoreDomain: 'env-store.myshopify.com', manifestStoreDomain: 'manifest-store.myshopify.com'}), 'manifest-store.myshopify.com');
});

test('Shopify catalog read validates a mocked product and strips raw Shopify IDs from consumer output', async () => {
  const mockClient: ShopifyCatalogClient = {
    fetchProducts: async () => ({
      products: {
        edges: [
          {node: {id: 'gid://shopify/Product/222', title: 'Aurora Headphones', handle: 'aurora-headphones', updatedAt: '2026-10-27T10:00:00.000Z', status: 'ACTIVE', variants: {edges: [{node: {id: 'gid://shopify/ProductVariant/111', price: {amount: '249.00', currencyCode: 'USD'}, availableForSale: true}}]}}},
        ],
      },
    }),
    fetchProduct: async () => ({productByHandle: null}),
  };
  const result = await readShopifyCatalog({config: {storeDomain: 'test-store.myshopify.com', version: '2025-07', tokenConfigured: true}, client: mockClient, companyId: 'company-1', principalCompanyId: 'company-1', now: '2026-10-27T12:00:00.000Z'});
  assert.equal(result.source, 'SHOPIFY');
  assert.match(result.label, /TEST/);
  assert.equal(result.verified.length, 1);
  assert.equal(result.verified[0].title, 'Aurora Headphones');
  assert.equal(result.verified[0].priceAmount, 249);
  const rendered = JSON.stringify(result);
  assert.ok(!rendered.includes('gid://shopify/'), 'consumer output must not contain raw Shopify IDs');
  assert.ok(!rendered.includes('aurora-headphones'), 'consumer output must not contain the product handle');
});

// Muse feature panel host wiring gate (full suite is
// apps/api/test/muse-panel-host.test.ts); this gate mirrors
// its fail-closed approval and resume cases and must stay in
// agreement with it. Wiring means panel callback -> existing
// server method only: no new public route, no live HTTP
// traffic, and no native Muse window integration is claimed.
import {
  createMusePanelHostHandlers,
} from '../src/muse-panel-host.js';

test('Muse panel host wiring requires a host-supplied token for approval and routes resume to resumeDraft', async () => {
  const calls: {approve: number; resume: number} = {approve: 0, resume: 0};
  const handlers = createMusePanelHostHandlers({
    principal: {subject: 'consumer-1', companyId: 'company-1'},
    companyId: 'company-1',
    draft: {draftId: 'draft-1', approvalToken: 'approval-token-from-session'},
    deps: {
      approveDraft: async () => { calls.approve += 1; return {status: 'payment_processing'}; },
      resumeDraft: async () => { calls.resume += 1; return {kind: 'present_review', draftId: 'draft-1', approvalRequired: true, approvalCarried: false, executeAgain: false, freshBuy: false}; },
      optInReminder: async () => { throw new Error('not_used_in_gate'); },
      optOutReminder: async () => { throw new Error('not_used_in_gate'); },
    },
    now: '2026-10-27T12:00:00.000Z',
  });
  await handlers.onApprove();
  const decision = await handlers.onResume();
  assert.equal(calls.approve, 1);
  assert.equal(calls.resume, 1);
  assert.equal(decision.kind, 'present_review');
  const noToken = createMusePanelHostHandlers({
    principal: {subject: 'consumer-1', companyId: 'company-1'},
    companyId: 'company-1',
    draft: {draftId: 'draft-1'},
    deps: {
      approveDraft: async () => { calls.approve += 1; return {}; },
      resumeDraft: async () => { throw new Error('not_used_in_gate'); },
      optInReminder: async () => { throw new Error('not_used_in_gate'); },
      optOutReminder: async () => { throw new Error('not_used_in_gate'); },
    },
    now: '2026-10-27T12:00:00.000Z',
  });
  await assert.rejects(noToken.onApprove(), /approval_token_required/);
  assert.equal(calls.approve, 1, 'an approval without a token must not reach the approval flow');
  assert.throws(
    () => createMusePanelHostHandlers({
      principal: {subject: 'consumer-1', companyId: 'company-1'},
      companyId: 'company-2',
      draft: {draftId: 'draft-1'},
      deps: {
        approveDraft: async () => { throw new Error('not_used_in_gate'); },
        resumeDraft: async () => { throw new Error('not_used_in_gate'); },
        optInReminder: async () => { throw new Error('not_used_in_gate'); },
        optOutReminder: async () => { throw new Error('not_used_in_gate'); },
      },
      now: '2026-10-27T12:00:00.000Z',
    }),
    /provider_readiness_company_mismatch/,
  );
});

// Muse feature panel routes gate (full suite is
// apps/api/test/muse-panel-routes.test.ts); this gate mirrors its
// fail-closed checks and must stay in agreement with it. The routes
// module is pure handler logic, NOT mounted in apps/api/src/index.ts:
// there is no live panel-to-API route, no live HTTP traffic, and no
// native Muse window integration claimed. See
// docs/live-panel-routes-design.md for the mount contract.
import {
  handleMusePanelRoute,
} from '../src/muse-panel-routes.js';

test('Muse panel routes fail closed without a principal, on tenant mismatch, and on draft mismatch, calling no handler', async () => {
  let calls = 0;
  const handlers = {
    onApprove: async () => { calls += 1; },
    onResume: async () => { calls += 1; return { kind: 'present_review' }; },
    onReminderOptIn: async () => { calls += 1; return {}; },
    onReminderOptOut: async () => { calls += 1; return {}; },
  };
  const base = {
    principal: { subject: 'consumer-1', companyId: 'company-1' },
    companyId: 'company-1',
    draftId: 'draft-1',
    expectedDraftId: 'draft-1',
    handlers,
  };
  const noPrincipal = await handleMusePanelRoute({ ...base, principal: null, action: 'approve' });
  assert.equal(noPrincipal.status, 401);
  assert.deepEqual(noPrincipal.body, { error: 'muse_panel_route_principal_required' });
  const mismatch = await handleMusePanelRoute({ ...base, companyId: 'company-2', action: 'approve' });
  assert.equal(mismatch.status, 403);
  assert.deepEqual(mismatch.body, { error: 'provider_readiness_company_mismatch' });
  const wrongDraft = await handleMusePanelRoute({ ...base, draftId: 'draft-9', action: 'approve' });
  assert.equal(wrongDraft.status, 400);
  assert.deepEqual(wrongDraft.body, { error: 'muse_panel_route_draft_mismatch' });
  assert.equal(calls, 0, 'no refused request may reach a handler');
});

// Multi-company TEST gates (full suites are
// apps/api/test/muse-multi-company.test.ts and
// apps/demo/test/muse-multi-company-demo.test.ts); these gates mirror
// the isolation cases that must stay in agreement with them. Both
// tenants use Muse Shopping Index as the platform — THEENRG.COM via
// Shopify Storefront read-only, ClutchAgent via Meta catalog read-only
// / Reel entry — and neither tenant's data may reach the other.
// All fixtures are TEST only; no live store, catalog, token, seller,
// or order is claimed here.
import {
  aggregateTenantBi,
  checkTenantDraftAccess,
  createClutchAgentMetaTestTenant,
  createTheenrgShopifyTestTenant,
  driftCheck,
  getTenantCatalog,
  otherTenantReviewUnchanged,
} from '../src/muse-multi-company.js';

test('Multi-company TEST gates: cross-tenant reads rejected, drift affects only its own tenant, BI is tenant-trimmed', () => {
  const now = '2026-10-27T12:00:00.000Z';
  const theenrg = createTheenrgShopifyTestTenant(now);
  const clutch = createClutchAgentMetaTestTenant(now);
  assert.equal(theenrg.catalogSource, 'shopify');
  assert.equal(clutch.catalogSource, 'meta');
  const own = getTenantCatalog({ companyId: theenrg.companyId }, theenrg, now);
  assert.ok(!('error' in own) && own.products.length === 1);
  assert.deepEqual(getTenantCatalog({ companyId: clutch.companyId }, theenrg, now), { error: 'provider_readiness_company_mismatch' });
  assert.deepEqual(checkTenantDraftAccess({ companyId: theenrg.companyId }, clutch.companyId), { error: 'provider_readiness_company_mismatch' });
  const drift = driftCheck(theenrg, 72, 78);
  assert.equal(drift.requiresReapproval, true);
  assert.equal(otherTenantReviewUnchanged(49, 49), true, 'ClutchAgent Meta total must be unchanged by THEENRG drift');
  const bi = aggregateTenantBi({ companyId: theenrg.companyId }, theenrg, [
    { draftId: 'd1', companyId: theenrg.companyId, verified: true, amount: 72, refunded: false },
    { draftId: 'd1', companyId: theenrg.companyId, verified: true, amount: 72, refunded: false },
    { draftId: 'd2', companyId: clutch.companyId, verified: true, amount: 49, refunded: false },
    { draftId: 'd3', companyId: theenrg.companyId, verified: false, amount: 100, refunded: false },
  ]);
  assert.ok(!('error' in bi));
  assert.equal(bi.verifiedOrderCount, 1, 'one outcome per draftId, verified only, other tenant trimmed');
  assert.equal(bi.netAmount, 72);
});

// Muse feature panel mount adapter gate (full suite is
// apps/api/test/muse-panel-mount.test.ts); this gate mirrors its
// fail-closed mount cases. The adapter is pure mount logic, NOT
// mounted in apps/api/src/index.ts: there is no live panel-to-API
// route, no live HTTP traffic, and no native Muse window claimed.
// See docs/live-panel-routes-design.md §5 for the exact mount
// blocker (no panel session token store in index.ts).
import { handleMusePanelMount } from '../src/muse-panel-mount.js';

test('Muse panel mount adapter gate: no principal, missing draft, and draft-company mismatch call no handler', async () => {
  let calls = 0;
  const mountDeps = {
    resolveDraft: async () => ({ draftId: 'draft-1', companyId: 'company-1' }),
    resolveApprovalToken: async () => 'approval-token-from-session',
    hostDeps: {
      approveDraft: async () => { calls += 1; },
      resumeDraft: async () => { calls += 1; return { kind: 'present_review' }; },
      optInReminder: async () => { calls += 1; return { consumerSubject: 'consumer-1', companyId: 'company-1', draftId: 'draft-1', status: 'PENDING', sentCount: 0, createdAt: '2026-10-27T12:00:00.000Z', updatedAt: '2026-10-27T12:00:00.000Z', sentAt: null }; },
      optOutReminder: async () => { calls += 1; return null; },
    },
    now: '2026-10-27T12:00:00.000Z',
  };
  const principal = { subject: 'consumer-1', companyId: 'company-1' };
  const noPrincipal = await handleMusePanelMount({ principal: null, draftId: 'draft-1', action: 'approve', deps: mountDeps });
  assert.equal(noPrincipal.status, 401);
  const missing = await handleMusePanelMount({ principal, draftId: 'draft-9', action: 'approve', deps: { ...mountDeps, resolveDraft: async () => null } });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: 'muse_panel_mount_draft_not_found' });
  const wrongCompany = await handleMusePanelMount({ principal, draftId: 'draft-1', action: 'approve', deps: { ...mountDeps, resolveDraft: async () => ({ draftId: 'draft-1', companyId: 'company-2' }) } });
  assert.equal(wrongCompany.status, 403);
  assert.equal(calls, 0, 'no refused mount request may reach a handler');
});
