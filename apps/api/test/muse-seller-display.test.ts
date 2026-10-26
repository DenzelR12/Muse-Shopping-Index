import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidSellerDisplayName,
  resolveSellerDisplayNameFromManifest,
  registerServerCompanyDisplayName,
  resolveServerCompanyDisplayName,
  resolveDraftItemTitles,
  validateOptionalReviewFact,
} from '../dist/muse-seller-display.js';

test('seller display names are never derived from a raw shop domain or account ID', () => {
  assert.equal(isValidSellerDisplayName('Demo Seller', 'demo.myshopify.com'), true);
  assert.equal(isValidSellerDisplayName('demo.myshopify.com', 'demo.myshopify.com'), false);
  assert.equal(isValidSellerDisplayName('acct_123', 'acct_123'), false);
  assert.equal(isValidSellerDisplayName('gid://shopify/Shop/1', 'shop.myshopify.com'), false);
  assert.equal(isValidSellerDisplayName('', 'shop.myshopify.com'), false);
});

test('manifest resolver requires an ACTIVE manifest for the same company', () => {
  assert.equal(
    resolveSellerDisplayNameFromManifest(
      {companyId: 'company', displayName: 'Demo Seller', status: 'ACTIVE'},
      'company',
      'demo.myshopify.com'
    ),
    'Demo Seller'
  );
  assert.throws(
    () => resolveSellerDisplayNameFromManifest(
      {companyId: 'other', displayName: 'Demo Seller', status: 'ACTIVE'},
      'company',
      'demo.myshopify.com'
    ),
    /muse_review_seller_display_required/
  );
  assert.throws(
    () => resolveSellerDisplayNameFromManifest(
      {companyId: 'company', displayName: 'Demo Seller', status: 'PAUSED'},
      'company',
      'demo.myshopify.com'
    ),
    /muse_review_seller_display_required/
  );
  assert.throws(
    () => resolveSellerDisplayNameFromManifest(null, 'company', 'demo.myshopify.com'),
    /muse_review_seller_display_required/
  );
});

test('server company registry only stores validated names and returns null otherwise', () => {
  assert.equal(resolveServerCompanyDisplayName('unregistered-company-xyz'), null);
  assert.equal(
    registerServerCompanyDisplayName('company-xyz', 'Demo Seller', 'demo.myshopify.com'),
    'Demo Seller'
  );
  assert.equal(resolveServerCompanyDisplayName('company-xyz'), 'Demo Seller');
  assert.throws(
    () => registerServerCompanyDisplayName('company-bad', 'demo.myshopify.com', 'demo.myshopify.com'),
    /muse_review_seller_display_required/
  );
});

test('item titles fail closed instead of falling back to a variant ID', () => {
  const line = {variantId: 'gid://shopify/ProductVariant/123', quantity: 1, unitPrice: '54.00'};
  assert.deepEqual(
    resolveDraftItemTitles([line], {'gid://shopify/ProductVariant/123': 'Assassin’s Creed Black Flag'}),
    [{...line, title: 'Assassin’s Creed Black Flag'}]
  );
  assert.throws(() => resolveDraftItemTitles([line], {}), /muse_review_item_title_required/);
  assert.throws(
    () => resolveDraftItemTitles([line], {'gid://shopify/ProductVariant/123': 'gid://shopify/ProductVariant/123'}),
    /muse_review_item_title_required/
  );
});

test('optional review facts are validated, never a raw ID or an invented date', () => {
  assert.equal(validateOptionalReviewFact(undefined), undefined);
  assert.equal(validateOptionalReviewFact('  October 28, 2026  '), 'October 28, 2026');
  assert.throws(() => validateOptionalReviewFact(''), /muse_review_fact_invalid/);
  assert.throws(() => validateOptionalReviewFact('x'.repeat(1001)), /muse_review_fact_invalid/);
  assert.throws(() => validateOptionalReviewFact('gid://shopify/ProductVariant/123'), /muse_review_fact_invalid/);
  assert.throws(() => validateOptionalReviewFact('shop.myshopify.com'), /muse_review_fact_invalid/);
  assert.throws(() => validateOptionalReviewFact('acct_123'), /muse_review_fact_invalid/);
});

// --- Persisted seller-manifest store (muse-seller-display-store.ts) ---
import {
  PostgresCompanySellerManifestStore,
  createPersistedSellerDisplayResolver,
} from '../dist/muse-seller-display-store.js';

// Minimal in-memory stand-in for a pg Pool: it implements only the
// SQL shapes the store issues (CREATE/ALTER no-ops, INSERT upserts
// keyed by company_id, SELECT by company_id), so a second store
// instance over the same pool simulates a restart.
function fakePool() {
  const rows = new Map();
  return {
    rows,
    async query(sql, params = []) {
      if (/INSERT INTO company_seller_manifests/.test(sql)) {
        const companyId = params[0];
        const existing = rows.get(companyId) ?? {
          company_id: companyId,
          display_name: null,
          external_account_id: null,
          origin: null,
          meta_verification: null,
          updated_at: new Date().toISOString(),
        };
        if (sql.includes('display_name')) {
          existing.display_name = params[1];
          existing.external_account_id = params[2];
        }
        if (sql.includes('meta_verification')) {
          existing.origin = params[1];
          existing.meta_verification = JSON.parse(params[2]);
        }
        existing.updated_at = new Date().toISOString();
        rows.set(companyId, {...existing});
        return {rows: [{...existing}]};
      }
      if (/SELECT \* FROM company_seller_manifests/.test(sql)) {
        const row = rows.get(params[0]);
        return {rows: row ? [{...row}] : []};
      }
      return {rows: []};
    },
  };
}

const validMetaVerification = {
  verified: true,
  verifiedAt: '2026-10-01T00:00:00Z',
  evidenceRef: 'meta-ev-1',
  issuer: 'Meta',
  source: 'meta-business-record',
};

test('persisted display name survives a new store instance over the same pool', async () => {
  const pool = fakePool();
  const first = new PostgresCompanySellerManifestStore(pool);
  await first.upsertDisplayName({
    companyId: 'company-persist',
    displayName: 'Persisted Seller',
    externalAccountId: 'persist.myshopify.com',
  });
  // Restart simulation: a fresh store instance, same underlying pool.
  const second = new PostgresCompanySellerManifestStore(pool);
  const record = await second.get('company-persist');
  assert.equal(record?.displayName, 'Persisted Seller');
  const resolve = createPersistedSellerDisplayResolver(second);
  assert.equal(await resolve('company-persist'), 'Persisted Seller');
});

test('persisted store rejects a raw-ID name and persists nothing for it', async () => {
  const pool = fakePool();
  const store = new PostgresCompanySellerManifestStore(pool);
  await assert.rejects(
    store.upsertDisplayName({
      companyId: 'company-raw',
      displayName: 'raw.myshopify.com',
      externalAccountId: 'raw.myshopify.com',
    }),
    /muse_review_seller_display_required/
  );
  assert.equal(await store.get('company-raw'), null);
  assert.equal(
    await createPersistedSellerDisplayResolver(store)('company-raw'),
    null
  );
});

test('persisted lookup is strictly per-company and never leaks across companies', async () => {
  const pool = fakePool();
  const store = new PostgresCompanySellerManifestStore(pool);
  await store.upsertDisplayName({
    companyId: 'company-a',
    displayName: 'Company A Seller',
    externalAccountId: 'a.myshopify.com',
  });
  assert.equal(await store.get('company-b'), null);
  const resolve = createPersistedSellerDisplayResolver(store);
  assert.equal(await resolve('company-b'), null);
  assert.equal(await resolve('company-a'), 'Company A Seller');
});

test('a stored name that no longer validates is not leaked to a review', async () => {
  const pool = fakePool();
  pool.rows.set('company-stale', {
    company_id: 'company-stale',
    display_name: 'stale.myshopify.com',
    external_account_id: 'stale.myshopify.com',
    origin: null,
    meta_verification: null,
    updated_at: new Date().toISOString(),
  });
  const store = new PostgresCompanySellerManifestStore(pool);
  assert.equal(
    await createPersistedSellerDisplayResolver(store, async () => null)(
      'company-stale'
    ),
    null
  );
});

test('persisted resolver wins over the legacy fallback, and display upserts preserve stored Meta evidence', async () => {
  const pool = fakePool();
  const store = new PostgresCompanySellerManifestStore(pool);
  await store.upsertMetaVerification({
    companyId: 'company-both',
    origin: 'meta',
    metaVerification: validMetaVerification,
  });
  await store.upsertDisplayName({
    companyId: 'company-both',
    displayName: 'Both Seller',
    externalAccountId: 'both.myshopify.com',
  });
  const record = await store.get('company-both');
  assert.equal(record?.displayName, 'Both Seller');
  assert.equal(record?.origin, 'meta');
  assert.deepEqual(record?.metaVerification, validMetaVerification);
  const resolve = createPersistedSellerDisplayResolver(
    store,
    async () => 'Legacy Seller'
  );
  assert.equal(await resolve('company-both'), 'Both Seller');
});

test('persisted store rejects self-attested Meta verification and stores nothing for it', async () => {
  const pool = fakePool();
  const store = new PostgresCompanySellerManifestStore(pool);
  await assert.rejects(
    store.upsertMetaVerification({
      companyId: 'company-self',
      origin: 'meta',
      metaVerification: {...validMetaVerification, source: 'self'},
    }),
    /meta_business_verification_required/
  );
  assert.equal(await store.get('company-self'), null);
});
