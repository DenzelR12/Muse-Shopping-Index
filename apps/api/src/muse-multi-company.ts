/**
 * Multi-company test harness (API side) for Muse Shopping Index.
 *
 * TEST CODE ONLY. NOT live, NOT real sellers, NOT real orders, NOT real
 * products or prices, NOT Business Verification, NOT a mounted route, and
 * NOT a public route. This module is pure: it performs no network access,
 * reads no secrets or tokens, and never grants approval, signs a draft, or
 * supplies a title or price from a model, a caption, or browser input.
 *
 * CORRECTED MAPPING (user correction, 2026-10-27, overrides any earlier
 * ClutchAgent-as-seller mapping):
 * - Company 1 = THEENRG.COM (Shopify tenant): catalogSource 'shopify',
 *   Shopify Storefront read-only path, TEST physical product only.
 * - Company 2 = ClutchAgent (Muse Meta tenant/context):
 *   catalogSource 'meta', Meta catalog read-only path, Reel entry /
 *   Muse panel context. ClutchAgent appears here ONLY as brand/context
 *   (see clutchAgentMetaContext below). ClutchAgent is NOT a Shopify
 *   seller and NOT a service checkout product, and this harness carries
 *   NO ClutchAgent service product or ClutchAgent service price: the
 *   Meta tenant's catalog item is a generic TEST catalog product via
 *   the Meta read-only path.
 *
 * WHAT IS STILL UNVERIFIED (NOT in this batch, NOT claimed live):
 * - THEENRG.COM: the real store domain, the real product, and the real
 *   Storefront token must be supplied and verified by the owner before
 *   any live Storefront read. Nothing in this file is a live read, a
 *   real THEENRG.COM product, or a real THEENRG.COM price.
 * - ClutchAgent Meta: the real Meta catalog, the System User / token,
 *   App Review, and Business Verification are NOT in this batch and are
 *   NOT verified here. Nothing in this file is a live Meta catalog read.
 *
 * Every catalog product below is a TEST fixture, labelled TEST in its
 * title, with a TEST fixture price.
 *
 * Safety properties preserved by this module, never weakened:
 * - Tenant-scoped: a principal may only read the tenant whose companyId
 *   matches the principal's companyId (or orgId, see TestPrincipal).
 *   A mismatch returns { error: 'provider_readiness_company_mismatch' }
 *   and never returns the other tenant's data.
 * - Fail closed: stale (>24h), unavailable, or missing/invalid
 *   title/price/currency catalog data returns
 *   { error: 'muse_catalog_unverifiable' } instead of a reviewable
 *   catalog. Uncertain data is never presented as verified.
 * - Raw IDs (gid://, myshopify.com, acct_) are stripped from titles
 *   before any consumer-facing output; they never reach a review.
 * - BI is tenant-trimmed: only the requested tenant's verified outcomes
 *   are counted, one outcome per draftId, with refunds subtracted.
 * - Drift requires reapproval: any total change for a tenant requires a
 *   fresh approval for that tenant, and never changes another tenant's
 *   totals.
 *
 * Each tenant's catalog is a plain array supplied by the caller on the
 * tenant object. These functions never consult a shared global catalog
 * and never mutate the tenant or outcome objects passed in.
 */

export type CatalogSource = 'meta' | 'shopify';

export type DeliveryType = 'access' | 'ship';

export interface TestCatalogProduct {
  title: string;
  priceAmount: number;
  currency: string;
  available: boolean;
  updatedAt: string;
  deliveryType: DeliveryType;
}

export interface TestTenant {
  companyId: string;
  displayName: string;
  catalogSource: CatalogSource;
  catalogProducts: TestCatalogProduct[];
}

/**
 * A calling principal. companyId is the primary tenant key; orgId is
 * accepted as a fallback so callers whose principal carries orgId (the
 * established tenant key elsewhere in the API) resolve to the same tenant.
 * When both are present, companyId wins.
 */
export interface TestPrincipal {
  companyId?: string;
  orgId?: string;
}

export interface TenantCatalogSuccess {
  companyId: string;
  displayName: string;
  catalogSource: CatalogSource;
  products: TestCatalogProduct[];
}

export interface TenantError {
  error: 'provider_readiness_company_mismatch' | 'muse_catalog_unverifiable';
}

export type TenantCatalogResult = TenantCatalogSuccess | TenantError;

export type TenantDraftAccessResult =
  | { allowed: true; companyId: string }
  | TenantError;

export interface TenantOutcome {
  draftId: string;
  companyId: string;
  verified: boolean;
  amount: number;
  refunded: boolean;
}

export interface TenantBiTotals {
  companyId: string;
  verifiedOrderCount: number;
  grossAmount: number;
  refundAmount: number;
  netAmount: number;
}

export type TenantBiResult = TenantBiTotals | TenantError;

export interface DriftResult {
  companyId: string;
  changed: boolean;
  requiresReapproval: boolean;
}

/** Catalog freshness window: older than this, a product is unverifiable. */
export const CATALOG_FRESHNESS_MS = 24 * 60 * 60 * 1000;

const COMPANY_MISMATCH: TenantError = {
  error: 'provider_readiness_company_mismatch',
};

const CATALOG_UNVERIFIABLE: TenantError = {
  error: 'muse_catalog_unverifiable',
};

export function resolvePrincipalCompanyId(
  principal: TestPrincipal,
): string | undefined {
  return principal.companyId ?? principal.orgId;
}

function isCompanyMismatch(
  principal: TestPrincipal,
  companyId: string,
): boolean {
  const principalCompanyId = resolvePrincipalCompanyId(principal);
  return principalCompanyId === undefined || principalCompanyId !== companyId;
}

/**
 * Strip raw provider/customer/payment identifiers from a title so they
 * can never reach consumer-facing output: gid:// URIs, myshopify.com
 * hostnames/URLs, and acct_ tokens. Collapses leftover whitespace.
 */
export function stripRawIdsFromTitle(title: string): string {
  return title
    .replace(/gid:\/\/\S+/g, '')
    .replace(/[^\s]*myshopify\.com[^\s]*/g, '')
    .replace(/acct_[A-Za-z0-9_-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function isVerifiableProduct(
  product: TestCatalogProduct,
  nowMs: number,
): boolean {
  if (typeof product.title !== 'string' || product.title.trim() === '') {
    return false;
  }
  if (
    typeof product.priceAmount !== 'number' ||
    !Number.isFinite(product.priceAmount) ||
    product.priceAmount < 0
  ) {
    return false;
  }
  if (typeof product.currency !== 'string' || product.currency.trim() === '') {
    return false;
  }
  if (product.available !== true) {
    return false;
  }
  const updatedMs = toMs(product.updatedAt);
  if (!Number.isFinite(updatedMs)) {
    return false;
  }
  const ageMs = nowMs - updatedMs;
  // A future-dated record is just as unverifiable as a stale one.
  if (ageMs < 0 || ageMs > CATALOG_FRESHNESS_MS) {
    return false;
  }
  return true;
}

/**
 * Return the calling tenant's own catalog only. A cross-tenant read is
 * rejected with a mismatch error and returns no catalog data at all.
 * If any product in the tenant's catalog is stale, unavailable, or
 * missing/invalid title/price/currency, the whole read is unverifiable
 * (fail closed) rather than returning a partial, reviewable catalog.
 * Returned products are sanitized copies with raw IDs stripped from
 * titles; the caller's tenant object is never mutated.
 */
export function getTenantCatalog(
  principal: TestPrincipal,
  tenant: TestTenant,
  now: string | Date,
): TenantCatalogResult {
  if (isCompanyMismatch(principal, tenant.companyId)) {
    return COMPANY_MISMATCH;
  }
  const nowMs = toMs(now);
  if (!Number.isFinite(nowMs)) {
    return CATALOG_UNVERIFIABLE;
  }
  if (
    !Array.isArray(tenant.catalogProducts) ||
    tenant.catalogProducts.length === 0
  ) {
    return CATALOG_UNVERIFIABLE;
  }
  for (const product of tenant.catalogProducts) {
    if (!isVerifiableProduct(product, nowMs)) {
      return CATALOG_UNVERIFIABLE;
    }
  }
  return {
    companyId: tenant.companyId,
    displayName: tenant.displayName,
    catalogSource: tenant.catalogSource,
    products: tenant.catalogProducts.map((product) => ({
      ...product,
      title: stripRawIdsFromTitle(product.title),
    })),
  };
}

/**
 * Draft-access gate for the multi-company harness: a principal may only
 * touch a draft belonging to its own tenant. A different tenant's draft
 * is rejected with the same mismatch error used for catalog reads, and
 * no draft data is returned.
 */
export function checkTenantDraftAccess(
  principal: TestPrincipal,
  draftCompanyId: string,
): TenantDraftAccessResult {
  if (isCompanyMismatch(principal, draftCompanyId)) {
    return COMPANY_MISMATCH;
  }
  return { allowed: true, companyId: draftCompanyId };
}

/**
 * Tenant-trimmed BI totals from caller-supplied outcomes. A principal
 * asking for another tenant's BI gets only the mismatch error, never
 * the other tenant's numbers. Within the requested tenant: only verified
 * outcomes count, only one outcome per draftId counts (the first
 * supplied outcome for a draft wins; later duplicates are ignored), and
 * refunded outcomes are subtracted from the gross (gross - refunds =
 * net). Outcomes belonging to any other company are trimmed out even
 * when the caller passes them in. Amounts are plain numbers as supplied;
 * no currency conversion is performed and no cross-tenant data is mixed
 * in. Payment labels are never produced here: exactly "Saved payment"
 * or "Shop Pay · Saved payment" are the only labels used at review time,
 * and this module emits no payment details at all.
 */
export function aggregateTenantBi(
  principal: TestPrincipal,
  tenant: TestTenant,
  outcomes: TenantOutcome[],
): TenantBiResult {
  if (isCompanyMismatch(principal, tenant.companyId)) {
    return COMPANY_MISMATCH;
  }
  const seenDraftIds = new Set<string>();
  let verifiedOrderCount = 0;
  let grossAmount = 0;
  let refundAmount = 0;
  for (const outcome of outcomes) {
    if (outcome.companyId !== tenant.companyId) {
      continue;
    }
    if (outcome.verified !== true) {
      continue;
    }
    if (seenDraftIds.has(outcome.draftId)) {
      continue;
    }
    seenDraftIds.add(outcome.draftId);
    if (typeof outcome.amount !== 'number' || !Number.isFinite(outcome.amount)) {
      continue;
    }
    verifiedOrderCount += 1;
    grossAmount += outcome.amount;
    if (outcome.refunded === true) {
      refundAmount += outcome.amount;
    }
  }
  return {
    companyId: tenant.companyId,
    verifiedOrderCount,
    grossAmount,
    refundAmount,
    netAmount: grossAmount - refundAmount,
  };
}

/**
 * Drift check for one tenant only: any change between the old and new
 * totals means the old approval no longer covers the terms, so a fresh
 * approval is required. The result is scoped to the tenant passed in
 * and says nothing about any other tenant.
 */
export function driftCheck(
  tenant: TestTenant,
  oldTotal: number,
  newTotal: number,
): DriftResult {
  const changed = oldTotal !== newTotal;
  return {
    companyId: tenant.companyId,
    changed,
    requiresReapproval: changed,
  };
}

/**
 * Pure helper expressing the other side of tenant-scoped drift: one
 * tenant's drift never rewrites another tenant's review. It returns the
 * other tenant's totals unchanged (a copy of the value, not a
 * recomputation), so a caller can assert the other tenant is untouched.
 */
export function otherTenantTotalsUnchanged(total: number): number {
  return total;
}

/**
 * Pure assertion helper for the same guarantee in before/after form:
 * true only when the other tenant's totals are exactly unchanged.
 */
export function otherTenantReviewUnchanged(
  beforeTotal: number,
  afterTotal: number,
): boolean {
  return beforeTotal === afterTotal;
}

// ---------------------------------------------------------------------------
// Brand/context and built-in TEST tenants (fixtures only, never live).
//
// Use the factory functions for freshness-sensitive checks: they stamp
// the TEST product with the `now` you pass in, so the product is fresh
// at that moment. The module-level constants below are fixed snapshots
// of the same fixtures; their timestamps are fixture timestamps, not
// live data, and they will read stale once 24h past that snapshot.
// ---------------------------------------------------------------------------

/**
 * ClutchAgent brand/context ONLY (Muse Meta tenant/context). These are
 * the only ClutchAgent facts carried by this harness. They describe the
 * Meta surface/app context; they are not a product, not a price, not a
 * seller enrollment, and not a checkout offer. ClutchAgent is NOT a
 * Shopify seller.
 */
export const clutchAgentMetaContext = {
  name: 'ClutchAgent',
  descriptor: 'AI Operating System for Athletes',
  focus: 'Sovereign tools for recruiting, NIL, and performance',
  legalName: 'ClutchAgent Inc',
  website: 'www.clutchagent.app',
  role: 'Muse Meta tenant/context: Meta catalog read-only + Reel entry / Muse panel context. NOT a Shopify seller, NOT a service checkout product.',
} as const;

/**
 * Company 1 (TEST fixture): THEENRG.COM, catalogSource 'shopify',
 * Shopify Storefront read-only path, TEST physical product only.
 * The product title, price, and store details here are TEST fixtures:
 * the real THEENRG.COM store domain, real product, real price, and
 * Storefront token are NOT supplied or verified in this file and must
 * be supplied and verified by the owner before any live Storefront read.
 */
export function createTheenrgShopifyTestTenant(now: string): TestTenant {
  return {
    companyId: 'test-theenrg',
    displayName: 'THEENRG.COM (TEST)',
    catalogSource: 'shopify',
    catalogProducts: [
      {
        title: 'Test Physical Product — TEST',
        priceAmount: 29,
        currency: 'USD',
        available: true,
        updatedAt: now,
        deliveryType: 'ship',
      },
    ],
  };
}

/**
 * Company 2 (TEST fixture): ClutchAgent, Muse Meta tenant/context,
 * catalogSource 'meta', Meta catalog read-only path. The catalog item
 * is a generic TEST catalog product via the Meta read-only path — it
 * is NOT a ClutchAgent service product and its TEST fixture price is
 * NOT a ClutchAgent price or offer. The deliveryType below is a
 * fixture classification only, not a ClutchAgent fulfillment claim.
 * Real Meta catalog, System User / token, App Review, and Business
 * Verification are NOT in this batch and are NOT verified here.
 */
export function createClutchAgentMetaTestTenant(now: string): TestTenant {
  return {
    companyId: 'test-clutchagent-meta',
    displayName: 'ClutchAgent — Muse Meta (TEST)',
    catalogSource: 'meta',
    catalogProducts: [
      {
        title: 'Test Catalog Product — TEST',
        priceAmount: 19,
        currency: 'USD',
        available: true,
        updatedAt: now,
        deliveryType: 'ship',
      },
    ],
  };
}

/** Fixed snapshots of the built-in TEST tenants (see factories above). */
export const testTenantTheenrg: TestTenant =
  createTheenrgShopifyTestTenant('2026-10-27T12:00:00.000Z');
export const testTenantClutchAgentMeta: TestTenant =
  createClutchAgentMetaTestTenant('2026-10-27T12:00:00.000Z');
