import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createShopifyCatalogClient,
  createShopifyStorefrontTransport,
  readShopifyCatalog,
  readShopifyProduct,
  resolveShopifyCatalogConfig,
  resolveShopifyStoreDomain,
  type ShopifyCatalogClient,
  type ShopifyCatalogConfig,
} from '../src/shopify-catalog.js';

// Mocked Storefront query transport only: no real Shopify call, no
// real token, no real store domain is ever used in this file. The
// store domains below are test-only myshopify.com names, not a
// real merchant's store.
const NOW = '2026-10-27T12:00:00.000Z';
const FRESH = '2026-10-27T10:00:00.000Z';
const STALE = '2026-10-20T00:00:00.000Z';

function config(tokenConfigured: boolean): ShopifyCatalogConfig {
  return {storeDomain: 'test-store.myshopify.com', version: '2025-07', tokenConfigured};
}

function variant(price: string, currency: string, available: boolean) {
  return {id: 'gid://shopify/ProductVariant/111', price: {amount: price, currencyCode: currency}, availableForSale: available};
}

function node(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/Product/222',
    title: 'Aurora Headphones',
    handle: 'aurora-headphones',
    updatedAt: FRESH,
    status: 'ACTIVE',
    variants: {edges: [{node: variant('249.00', 'USD', true)}]},
    ...overrides,
  };
}

function mockClient(calls: string[], products: unknown, product: unknown = null): ShopifyCatalogClient {
  return {
    fetchProducts: async () => { calls.push('products'); return products; },
    fetchProduct: async (handle: string) => { calls.push(`product:${handle}`); return product; },
  };
}

const goodProducts = {
  products: {
    edges: [
      {node: node()},
      {node: node({title: 'Travel Case', variants: {edges: [{node: variant('20.00', 'USD', true)}]}})},
    ],
  },
};

test('missing token fails closed with no network call', async () => {
  const calls: string[] = [];
  await assert.rejects(
    readShopifyCatalog({config: config(false), client: mockClient(calls, goodProducts), companyId: 'company-1', principalCompanyId: 'company-1', now: NOW}),
    /muse_shopify_catalog_not_configured/,
  );
  assert.equal(calls.length, 0);
});

test('token present but no startup-registered client fails closed with no network call', async () => {
  await assert.rejects(
    readShopifyCatalog({config: config(true), client: null, companyId: 'company-1', principalCompanyId: 'company-1', now: NOW}),
    /muse_shopify_catalog_client_not_registered/,
  );
});

test('tenant mismatch fails closed with no network call', async () => {
  const calls: string[] = [];
  await assert.rejects(
    readShopifyCatalog({config: config(true), client: mockClient(calls, goodProducts), companyId: 'company-1', principalCompanyId: 'company-2', now: NOW}),
    /provider_readiness_company_mismatch/,
  );
  assert.equal(calls.length, 0);
});

test('missing store domain fails closed with no network call and never a default store', async () => {
  const calls: string[] = [];
  const noStoreConfig: ShopifyCatalogConfig = {storeDomain: null, version: '2025-07', tokenConfigured: true};
  await assert.rejects(
    readShopifyCatalog({config: noStoreConfig, client: mockClient(calls, goodProducts), companyId: 'company-1', principalCompanyId: 'company-1', envStoreDomain: null, manifestStoreDomain: null, now: NOW}),
    /muse_shopify_store_not_configured/,
  );
  assert.equal(calls.length, 0);
  assert.equal(resolveShopifyStoreDomain({}), null);
  assert.equal(resolveShopifyStoreDomain({envStoreDomain: 'env-store.myshopify.com', manifestStoreDomain: 'manifest-store.myshopify.com'}), 'manifest-store.myshopify.com');
});

test('successful mocked read validates items and strips raw provider IDs from consumer output', async () => {
  const calls: string[] = [];
  const result = await readShopifyCatalog({config: config(true), client: mockClient(calls, goodProducts), companyId: 'company-1', principalCompanyId: 'company-1', now: NOW});
  assert.deepEqual(calls, ['products']);
  assert.equal(result.source, 'SHOPIFY');
  assert.match(result.label, /TEST/);
  assert.equal(result.verified.length, 2);
  assert.equal(result.verified[0].title, 'Aurora Headphones');
  assert.equal(result.verified[0].priceAmount, 249);
  assert.equal(result.verified[0].currency, 'USD');
  assert.equal(result.verified[1].title, 'Travel Case');
  assert.equal(result.validUntil, '2026-10-28T12:00:00.000Z');
  assert.equal(result.refreshRequired, false);
  const rendered = JSON.stringify(result);
  for (const rawId of ['gid://shopify/Product/222', 'gid://shopify/ProductVariant/111', 'aurora-headphones', 'test-store.myshopify.com']) {
    assert.ok(!rendered.includes(rawId), `consumer output must not contain ${rawId}`);
  }
});

test('stale price, missing price, and out-of-stock are handled without a guessed price', async () => {
  const calls: string[] = [];
  const result = await readShopifyCatalog({
    config: config(true),
    client: mockClient(calls, {
      products: {
        edges: [
          {node: node({title: 'Stale Item', updatedAt: STALE})},
          {node: node({title: 'No Price Item', variants: {edges: []}})},
          {node: node({title: 'Sold Out Item', variants: {edges: [{node: variant('10.00', 'USD', false)}]}})},
          {node: node({title: 'Draft Item', status: 'DRAFT'})},
        ],
      },
    }),
    companyId: 'company-1', principalCompanyId: 'company-1', now: NOW,
  });
  assert.equal(result.verified.length, 0);
  assert.equal(result.unavailable.length, 2);
  assert.equal(result.unavailable[0].title, 'Sold Out Item');
  assert.equal(result.unavailable[1].title, 'Draft Item');
  assert.equal(result.unverifiable.length, 2);
  assert.equal(result.unverifiable[0].reason, 'stale');
  assert.equal(result.unverifiable[1].reason, 'invalid_price');
  assert.equal(result.refreshRequired, true);
});

test('single-product read returns the classified item and null for an unknown handle', async () => {
  const calls: string[] = [];
  const client = mockClient(calls, goodProducts, {productByHandle: node()});
  const found = await readShopifyProduct({config: config(true), client, companyId: 'company-1', principalCompanyId: 'company-1', handle: 'aurora-headphones', now: NOW});
  assert.ok(found && 'priceAmount' in found && found.priceAmount === 249);
  const missing = await readShopifyProduct({config: config(true), client: mockClient([], goodProducts, {productByHandle: null}), companyId: 'company-1', principalCompanyId: 'company-1', handle: 'no-such-product', now: NOW});
  assert.equal(missing, null);
  assert.deepEqual(calls, ['product:aurora-headphones']);
});

test('client exposes query only, by construction, and rejects mutations before any network call', async () => {
  const seen: Array<{url: string; method: string; headers: Record<string, string>; body: string}> = [];
  const transport = createShopifyStorefrontTransport({
    storeDomain: 'test-store.myshopify.com',
    version: '2025-07',
    token: 'test-token-not-real',
    fetchImpl: async (url, init) => {
      seen.push({url, method: init.method, headers: init.headers, body: init.body});
      return {ok: true, status: 200, json: async () => ({data: {products: {edges: []}}})};
    },
  });
  assert.deepEqual(Object.keys(transport), ['query']);
  const client = createShopifyCatalogClient({transport});
  assert.deepEqual(Object.keys(client).sort(), ['fetchProduct', 'fetchProducts']);
  await client.fetchProducts();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, 'https://test-store.myshopify.com/api/2025-07/graphql.json');
  assert.ok(!seen[0].url.includes('test-token-not-real'), 'token must never be in the URL');
  assert.ok(!seen[0].body.includes('test-token-not-real'), 'token must never be in the body');
  assert.equal(seen[0].headers['X-Shopify-Storefront-Access-Token'], 'test-token-not-real');
  const body = JSON.parse(seen[0].body) as {query: string};
  assert.match(body.query, /^query\b/);
  assert.doesNotMatch(body.query, /\bmutation\b/);
  assert.doesNotMatch(body.query, /\bcart\b/i);
  assert.doesNotMatch(body.query, /\bcheckout\b/i);
  await assert.rejects(transport.query('mutation CartCreate { cartCreate { cart { id } } }', {}), /muse_shopify_query_not_readonly/);
  assert.equal(seen.length, 1, 'a rejected mutation must not reach the network');
});

test('config defaults, env overrides, and store-domain validation', () => {
  const defaults = resolveShopifyCatalogConfig({});
  assert.equal(defaults.storeDomain, null);
  assert.equal(defaults.version, '2025-07');
  assert.equal(defaults.tokenConfigured, false);
  const overridden = resolveShopifyCatalogConfig({SHOPIFY_STORE_DOMAIN: 'https://my-store.myshopify.com/', SHOPIFY_API_VERSION: '2025-07', SHOPIFY_STOREFRONT_ACCESS_TOKEN: 'x'} as NodeJS.ProcessEnv);
  assert.equal(overridden.storeDomain, 'my-store.myshopify.com');
  assert.equal(overridden.tokenConfigured, true);
  assert.throws(() => resolveShopifyCatalogConfig({SHOPIFY_STORE_DOMAIN: 'not-a-store.example.com'} as NodeJS.ProcessEnv), /shopify_catalog_config_invalid/);
  assert.throws(() => resolveShopifyCatalogConfig({SHOPIFY_API_VERSION: 'v2025'} as NodeJS.ProcessEnv), /shopify_catalog_config_invalid/);
});
