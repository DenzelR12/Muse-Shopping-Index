import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateTenantBi,
  checkTenantDraftAccess,
  clutchAgentMetaContext,
  createClutchAgentMetaTestTenant,
  createTheenrgShopifyTestTenant,
  driftCheck,
  getTenantCatalog,
  otherTenantReviewUnchanged,
  otherTenantTotalsUnchanged,
  stripRawIdsFromTitle,
  type TestTenant,
} from '../src/muse-multi-company.js';

// TEST fixtures only: no live sellers, orders, products, or prices.
// Timestamps are computed from the real clock at run time so freshness
// assertions hold whenever the suite runs (fresh = 1h ago, stale =
// 25h ago). Corrected mapping: THEENRG.COM = Shopify tenant,
// ClutchAgent = Muse Meta tenant/context (brand/context only, NOT a
// Shopify seller, NOT a service checkout product).
const NOW = new Date().toISOString();
const FRESH = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const STALE = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

const tenantTheenrg: TestTenant = createTheenrgShopifyTestTenant(FRESH);
const tenantClutchAgentMeta: TestTenant =
  createClutchAgentMetaTestTenant(FRESH);
const principalTheenrg = { companyId: 'test-theenrg' };
const principalClutchAgentMeta = { companyId: 'test-clutchagent-meta' };
const principalTheenrgByOrgId = { orgId: 'test-theenrg' };

test('cross-tenant catalog read is rejected and returns no other tenant data', () => {
  const theenrgReadsMeta = getTenantCatalog(
    principalTheenrg,
    tenantClutchAgentMeta,
    NOW,
  );
  assert.deepEqual(theenrgReadsMeta, {
    error: 'provider_readiness_company_mismatch',
  });
  assert.ok(!JSON.stringify(theenrgReadsMeta).includes('Test Catalog Product'));
  const metaReadsTheenrg = getTenantCatalog(
    principalClutchAgentMeta,
    tenantTheenrg,
    NOW,
  );
  assert.deepEqual(metaReadsTheenrg, {
    error: 'provider_readiness_company_mismatch',
  });
  assert.ok(!JSON.stringify(metaReadsTheenrg).includes('Test Physical Product'));
});

test('cross-tenant draft access is rejected', () => {
  assert.deepEqual(
    checkTenantDraftAccess(principalTheenrg, 'test-clutchagent-meta'),
    { error: 'provider_readiness_company_mismatch' },
  );
  assert.deepEqual(
    checkTenantDraftAccess(principalClutchAgentMeta, 'test-theenrg'),
    { error: 'provider_readiness_company_mismatch' },
  );
  assert.deepEqual(
    checkTenantDraftAccess(principalTheenrg, 'test-theenrg'),
    { allowed: true, companyId: 'test-theenrg' },
  );
});

test('cross-tenant BI is rejected and returns no other tenant totals', () => {
  const result = aggregateTenantBi(principalTheenrg, tenantClutchAgentMeta, [
    {
      draftId: 'draft-meta-1',
      companyId: 'test-clutchagent-meta',
      verified: true,
      amount: 19,
      refunded: false,
    },
  ]);
  assert.deepEqual(result, {
    error: 'provider_readiness_company_mismatch',
  });
});

test('THEENRG.COM catalog returns THEENRG only, via companyId and via orgId', () => {
  const byCompany = getTenantCatalog(principalTheenrg, tenantTheenrg, NOW);
  if ('products' in byCompany) {
    assert.equal(byCompany.companyId, 'test-theenrg');
    assert.equal(byCompany.catalogSource, 'shopify');
    assert.equal(byCompany.products.length, 1);
    assert.equal(byCompany.products[0].title, 'Test Physical Product — TEST');
    assert.equal(byCompany.products[0].deliveryType, 'ship');
    assert.ok(!JSON.stringify(byCompany).includes('Test Catalog Product'));
  } else {
    assert.fail('expected THEENRG.COM catalog success');
  }
  // A principal carrying orgId (the established tenant key) resolves
  // to the same tenant.
  const byOrg = getTenantCatalog(principalTheenrgByOrgId, tenantTheenrg, NOW);
  assert.ok('products' in byOrg);
});

test('ClutchAgent Meta catalog returns a generic TEST product only, never a ClutchAgent service product', () => {
  // Brand/context facts only: no service product, no service price.
  assert.equal(clutchAgentMetaContext.name, 'ClutchAgent');
  assert.equal(
    clutchAgentMetaContext.descriptor,
    'AI Operating System for Athletes',
  );
  assert.equal(
    clutchAgentMetaContext.focus,
    'Sovereign tools for recruiting, NIL, and performance',
  );
  assert.equal(clutchAgentMetaContext.legalName, 'ClutchAgent Inc');
  assert.equal(clutchAgentMetaContext.website, 'www.clutchagent.app');
  const result = getTenantCatalog(
    principalClutchAgentMeta,
    tenantClutchAgentMeta,
    NOW,
  );
  if ('products' in result) {
    assert.equal(result.companyId, 'test-clutchagent-meta');
    assert.equal(result.catalogSource, 'meta');
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0].title, 'Test Catalog Product — TEST');
    assert.ok(!result.products[0].title.includes('ClutchAgent'));
    assert.ok(!result.products[0].title.includes('Platform Access'));
    assert.ok(!JSON.stringify(result).includes('Test Physical Product'));
  } else {
    assert.fail('expected ClutchAgent Meta catalog success');
  }
});

test('stale catalog product is unverifiable, never reviewable', () => {
  const staleTenant = createTheenrgShopifyTestTenant(STALE);
  assert.deepEqual(getTenantCatalog(principalTheenrg, staleTenant, NOW), {
    error: 'muse_catalog_unverifiable',
  });
});

test('unavailable catalog product is unverifiable', () => {
  const unavailable: TestTenant = {
    ...tenantClutchAgentMeta,
    catalogProducts: [
      { ...tenantClutchAgentMeta.catalogProducts[0], available: false },
    ],
  };
  assert.deepEqual(
    getTenantCatalog(principalClutchAgentMeta, unavailable, NOW),
    { error: 'muse_catalog_unverifiable' },
  );
});

test('missing price, title, or currency is unverifiable', () => {
  const base = tenantTheenrg.catalogProducts[0];
  const noPrice: TestTenant = {
    ...tenantTheenrg,
    catalogProducts: [{ ...base, priceAmount: Number.NaN }],
  };
  assert.deepEqual(getTenantCatalog(principalTheenrg, noPrice, NOW), {
    error: 'muse_catalog_unverifiable',
  });
  const noTitle: TestTenant = {
    ...tenantTheenrg,
    catalogProducts: [{ ...base, title: '   ' }],
  };
  assert.deepEqual(getTenantCatalog(principalTheenrg, noTitle, NOW), {
    error: 'muse_catalog_unverifiable',
  });
  const noCurrency: TestTenant = {
    ...tenantTheenrg,
    catalogProducts: [{ ...base, currency: '' }],
  };
  assert.deepEqual(getTenantCatalog(principalTheenrg, noCurrency, NOW), {
    error: 'muse_catalog_unverifiable',
  });
});

test('raw IDs are stripped from titles and the tenant object is not mutated', () => {
  const dirty: TestTenant = {
    ...tenantTheenrg,
    catalogProducts: [
      {
        ...tenantTheenrg.catalogProducts[0],
        title:
          'Test Physical Product — TEST gid://shopify/Product/123 test-store.myshopify.com acct_456',
      },
    ],
  };
  const result = getTenantCatalog(principalTheenrg, dirty, NOW);
  if ('products' in result) {
    assert.equal(result.products[0].title, 'Test Physical Product — TEST');
    assert.ok(!JSON.stringify(result).includes('gid://'));
    assert.ok(!JSON.stringify(result).includes('myshopify.com'));
    assert.ok(!JSON.stringify(result).includes('acct_'));
  } else {
    assert.fail('expected catalog success with stripped title');
  }
  // The caller's fixture still carries the raw title: stripping happens
  // on the returned copy, never by mutating the tenant.
  assert.ok(dirty.catalogProducts[0].title.includes('gid://'));
  assert.equal(
    stripRawIdsFromTitle('gid://shopify/Product/1 and acct_2'),
    'and',
  );
});

test('THEENRG drift requires reapproval while ClutchAgent Meta totals are unchanged', () => {
  const clutchAgentTotalBefore = 19;
  const drift = driftCheck(tenantTheenrg, 29, 35);
  assert.deepEqual(drift, {
    companyId: 'test-theenrg',
    changed: true,
    requiresReapproval: true,
  });
  // No drift for an unchanged total: no reapproval required.
  assert.deepEqual(driftCheck(tenantTheenrg, 29, 29), {
    companyId: 'test-theenrg',
    changed: false,
    requiresReapproval: false,
  });
  // THEENRG's drift does not touch the ClutchAgent Meta review:
  // ClutchAgent totals come back unchanged.
  assert.equal(otherTenantTotalsUnchanged(clutchAgentTotalBefore), 19);
  assert.equal(
    otherTenantReviewUnchanged(clutchAgentTotalBefore, clutchAgentTotalBefore),
    true,
  );
  assert.equal(otherTenantReviewUnchanged(clutchAgentTotalBefore, 25), false);
});

test('ClutchAgent Meta drift requires reapproval while THEENRG totals are unchanged', () => {
  const theenrgTotalBefore = 29;
  const drift = driftCheck(tenantClutchAgentMeta, 19, 24);
  assert.deepEqual(drift, {
    companyId: 'test-clutchagent-meta',
    changed: true,
    requiresReapproval: true,
  });
  assert.equal(otherTenantTotalsUnchanged(theenrgTotalBefore), 29);
  assert.equal(
    otherTenantReviewUnchanged(theenrgTotalBefore, theenrgTotalBefore),
    true,
  );
});

test('BI counts verified outcomes only, one per draftId, refunds subtract', () => {
  const result = aggregateTenantBi(principalTheenrg, tenantTheenrg, [
    {
      draftId: 'draft-1',
      companyId: 'test-theenrg',
      verified: true,
      amount: 100,
      refunded: false,
    },
    // Duplicate of draft-1: counted once, not twice.
    {
      draftId: 'draft-1',
      companyId: 'test-theenrg',
      verified: true,
      amount: 100,
      refunded: false,
    },
    // Unverified: never counted.
    {
      draftId: 'draft-2',
      companyId: 'test-theenrg',
      verified: false,
      amount: 999,
      refunded: false,
    },
    // Verified but refunded: counted, then subtracted.
    {
      draftId: 'draft-3',
      companyId: 'test-theenrg',
      verified: true,
      amount: 50,
      refunded: true,
    },
  ]);
  assert.deepEqual(result, {
    companyId: 'test-theenrg',
    verifiedOrderCount: 2,
    grossAmount: 150,
    refundAmount: 50,
    netAmount: 100,
  });
});

test('BI trims out other-tenant outcomes even when passed in', () => {
  const result = aggregateTenantBi(
    principalClutchAgentMeta,
    tenantClutchAgentMeta,
    [
      {
        draftId: 'draft-meta-1',
        companyId: 'test-clutchagent-meta',
        verified: true,
        amount: 19,
        refunded: false,
      },
      {
        draftId: 'draft-theenrg-1',
        companyId: 'test-theenrg',
        verified: true,
        amount: 29,
        refunded: false,
      },
    ],
  );
  assert.deepEqual(result, {
    companyId: 'test-clutchagent-meta',
    verifiedOrderCount: 1,
    grossAmount: 19,
    refundAmount: 0,
    netAmount: 19,
  });
});
