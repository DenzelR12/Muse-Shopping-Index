import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMetaCatalogClient,
  createMetaCatalogGraphTransport,
  readMetaCatalog,
  resolveMetaCatalogConfig,
  resolveMetaCatalogId,
  type MetaCatalogClient,
  type MetaCatalogConfig,
} from '../src/meta-catalog.js';

// Mocked Graph API transport only: no real Meta call, no real token,
// no real catalog ID is ever used in this file.
const NOW = '2026-10-27T12:00:00.000Z';
const FRESH = '2026-10-27T10:00:00.000Z';
const STALE = '2026-10-20T00:00:00.000Z';

function config(tokenConfigured: boolean): MetaCatalogConfig {
  return {baseUrl: 'https://graph.facebook.com', version: 'v26.0', tokenConfigured};
}

function mockClient(calls: string[], catalog: unknown, products: unknown): MetaCatalogClient {
  return {
    fetchCatalog: async () => { calls.push('catalog'); return catalog; },
    fetchProducts: async () => { calls.push('products'); return products; },
  };
}

const catalogDetails = {id: 'catalog-provider-123', name: 'Test Catalog'};
const goodProducts = {
  data: [
    {id: 'product-provider-1', retailer_id: 'SKU-1', title: 'Aurora Headphones', price: '249.00 USD', availability: 'in stock', updated_time: FRESH},
    {id: 'product-provider-2', name: 'Travel Case', price: {amount: 20, currency: 'USD'}, availability: 'in stock'},
  ],
};

test('missing token fails closed with no network call', async () => {
  const calls: string[] = [];
  await assert.rejects(
    readMetaCatalog({config: config(false), client: mockClient(calls, catalogDetails, goodProducts), companyId: 'company-1', principalCompanyId: 'company-1', catalogId: 'catalog-1', now: NOW}),
    /muse_catalog_not_configured/,
  );
  assert.equal(calls.length, 0);
});

test('token present but no startup-registered client fails closed with no network call', async () => {
  await assert.rejects(
    readMetaCatalog({config: config(true), client: null, companyId: 'company-1', principalCompanyId: 'company-1', catalogId: 'catalog-1', now: NOW}),
    /muse_catalog_client_not_registered/,
  );
});

test('tenant mismatch fails closed with no network call', async () => {
  const calls: string[] = [];
  await assert.rejects(
    readMetaCatalog({config: config(true), client: mockClient(calls, catalogDetails, goodProducts), companyId: 'company-1', principalCompanyId: 'company-2', catalogId: 'catalog-1', now: NOW}),
    /provider_readiness_company_mismatch/,
  );
  assert.equal(calls.length, 0);
});

test('missing catalog ID fails closed with no network call and never a default catalog', async () => {
  const calls: string[] = [];
  await assert.rejects(
    readMetaCatalog({config: config(true), client: mockClient(calls, catalogDetails, goodProducts), companyId: 'company-1', principalCompanyId: 'company-1', catalogId: null, now: NOW}),
    /muse_catalog_id_not_configured/,
  );
  assert.equal(calls.length, 0);
  assert.equal(resolveMetaCatalogId({}), null);
});

test('successful mocked read validates items and strips raw provider IDs from consumer output', async () => {
  const calls: string[] = [];
  const result = await readMetaCatalog({config: config(true), client: mockClient(calls, catalogDetails, goodProducts), companyId: 'company-1', principalCompanyId: 'company-1', catalogId: 'catalog-1', now: NOW});
  assert.deepEqual(calls, ['catalog', 'products']);
  assert.equal(result.source, 'META CATALOG');
  assert.match(result.label, /TEST/);
  assert.equal(result.catalogName, 'Test Catalog');
  assert.equal(result.verified.length, 2);
  assert.equal(result.verified[0].title, 'Aurora Headphones');
  assert.equal(result.verified[0].priceAmount, 249);
  assert.equal(result.verified[0].currency, 'USD');
  assert.equal(result.verified[1].title, 'Travel Case');
  assert.equal(result.validUntil, '2026-10-28T12:00:00.000Z');
  assert.equal(result.refreshRequired, false);
  const rendered = JSON.stringify(result);
  for (const rawId of ['catalog-provider-123', 'product-provider-1', 'product-provider-2', 'SKU-1']) {
    assert.ok(!rendered.includes(rawId), `consumer output must not contain ${rawId}`);
  }
});

test('stale price/stock is unverifiable and refresh required, never a guessed price', async () => {
  const calls: string[] = [];
  const result = await readMetaCatalog({
    config: config(true),
    client: mockClient(calls, catalogDetails, {data: [
      {id: 'product-provider-9', title: 'Stale Item', price: '99.00 USD', availability: 'in stock', updated_time: STALE},
      {id: 'product-provider-10', title: 'No Price Item', availability: 'in stock'},
      {id: 'product-provider-11', title: 'Sold Out Item', price: '10.00 USD', availability: 'out of stock'},
    ]}),
    companyId: 'company-1', principalCompanyId: 'company-1', catalogId: 'catalog-1', now: NOW,
  });
  assert.equal(result.verified.length, 0);
  assert.equal(result.unavailable.length, 1);
  assert.equal(result.unavailable[0].title, 'Sold Out Item');
  assert.equal(result.unverifiable.length, 2);
  assert.equal(result.unverifiable[0].reason, 'stale');
  assert.equal(result.unverifiable[1].reason, 'invalid_price');
  assert.equal(result.refreshRequired, true);
});

test('client exposes GET only, by construction', async () => {
  const seen: Array<{url: string; method: string; headers: Record<string, string>}> = [];
  const transport = createMetaCatalogGraphTransport({
    baseUrl: 'https://graph.facebook.com',
    version: 'v26.0',
    token: 'test-token-not-real',
    fetchImpl: async (url, init) => {
      seen.push({url, method: init.method, headers: init.headers});
      return {ok: true, status: 200, json: async () => (url.endsWith('/products') ? {data: []} : {name: 'Test Catalog'})};
    },
  });
  assert.deepEqual(Object.keys(transport), ['get']);
  const client = createMetaCatalogClient({transport, baseUrl: 'https://graph.facebook.com', version: 'v26.0'});
  assert.deepEqual(Object.keys(client).sort(), ['fetchCatalog', 'fetchProducts']);
  await client.fetchCatalog('catalog-1');
  await client.fetchProducts('catalog-1');
  assert.equal(seen.length, 2);
  for (const call of seen) {
    assert.equal(call.method, 'GET');
    assert.ok(call.url.startsWith('https://graph.facebook.com/v26.0/catalog-1'));
    assert.ok(!call.url.includes('test-token-not-real'), 'token must never be in the URL');
    assert.equal(call.headers.Authorization, 'Bearer test-token-not-real');
  }
  assert.ok(seen[1].url.endsWith('/products'));
});

test('config defaults, env overrides, and manifest catalog-ID precedence', () => {
  const defaults = resolveMetaCatalogConfig({});
  assert.equal(defaults.baseUrl, 'https://graph.facebook.com');
  assert.equal(defaults.version, 'v26.0');
  assert.equal(defaults.tokenConfigured, false);
  const overridden = resolveMetaCatalogConfig({META_GRAPH_API_BASE_URL: 'https://graph.facebook.com/', META_GRAPH_API_VERSION: 'v26.0', META_CATALOG_ACCESS_TOKEN: 'x'} as NodeJS.ProcessEnv);
  assert.equal(overridden.baseUrl, 'https://graph.facebook.com');
  assert.equal(overridden.tokenConfigured, true);
  assert.throws(() => resolveMetaCatalogConfig({META_GRAPH_API_VERSION: '26'} as NodeJS.ProcessEnv), /meta_catalog_config_invalid/);
  assert.equal(resolveMetaCatalogId({envCatalogId: 'env-1', manifestCatalogId: 'manifest-1'}), 'manifest-1');
  assert.equal(resolveMetaCatalogId({envCatalogId: 'env-1'}), 'env-1');
});
