/**
 * Read-only Shopify catalog client — Muse Shopping Index.
 *
 * This is a Muse feature provider, NOT a storefront. Shopify is
 * one provider behind the server, never the frontend: this client
 * reads one company's own Shopify catalog so the server can
 * validate a title, price, currency, and stock state before any
 * review is ever rendered. It builds no shop site, no cart page,
 * no checkout page, and no product-listing site, and it must
 * never be presented as one.
 *
 * CHOSEN READ PATH — exactly one, by design:
 * Shopify Storefront API product query only, with a Storefront
 * access token. The Admin API is NOT used by this module: no
 * Admin token is read here, no Admin endpoint is called, and
 * no admin privilege is needed for a catalog read. The
 * Storefront API is the shopper-facing, read-oriented API;
 * that is the narrowest privilege that can answer "what does
 * this company sell, at what price, in stock or not".
 *
 * READ-ONLY BY CONSTRUCTION:
 * - The only transport method is `query`, and it accepts only
 *   GraphQL query operations. A document that does not start
 *   with the `query` keyword, or that contains `mutation` or
 *   `subscription`, is rejected before any network call with
 *   muse_shopify_query_not_readonly. There is no cart, no
 *   checkout, no write, no order, and no customer endpoint
 *   anywhere in this module, and no way to express one
 *   through it — adding one would require new code, which
 *   this module's review rule forbids.
 * - The client interface exposes exactly two reads:
 *   fetchProducts (a product list) and fetchProduct (one
 *   product by handle). Both use fixed query documents
 *   defined in this module; callers supply only a handle or
 *   a page size, never a query document.
 * - This client renders no review, signs no draft, issues no
 *   approval, and executes no purchase. It is an internal
 *   helper (see readShopifyCatalog); there is deliberately
 *   no public route at all in this change, and no approval
 *   is consumed by any read.
 *
 * ENDPOINT (Shopify Storefront API, versioned):
 * - POST https://{storeDomain}/api/{version}/graphql.json
 *   with header X-Shopify-Storefront-Access-Token and a JSON
 *   body {query, variables}. The token travels only in that
 *   header, never in a URL query string, and is never logged
 *   or echoed. The store domain comes from
 *   SHOPIFY_STORE_DOMAIN or from the authenticated company's
 *   own manifest (manifest wins); version comes from
 *   SHOPIFY_API_VERSION and defaults to 2025-07.
 * - ENDPOINT/VERSION SHAPE IS NOT LIVE-VERIFIED: the query
 *   documents below follow the standard Storefront API
 *   product/variant/Money shape (products { edges { node {
 *   title, handle, updatedAt, status, variants { price {
 *   amount, currencyCode }, availableForSale } } } }), but
 *   no live Shopify store has been read through this client
 *   yet — all tests use a mocked query transport, no store,
 *   token, or seller is verified, and no live Shopify read,
 *   live seller, Shop Pay partnership, or Muse distribution
 *   is claimed anywhere here (see docs/shopify-catalog.md).
 *   A store-owner call about a real store is pending at the
 *   time of this change; this client was built so that call
 *   can be answered with code that is already ready, not
 *   with a promise to build it later.
 *
 * GATING (same fail-closed pattern as meta-catalog.ts), in
 * order, before any network call:
 * - SHOPIFY_STOREFRONT_ACCESS_TOKEN missing ->
 *   muse_shopify_catalog_not_configured, no approval
 *   consumed, no network call.
 * - Token present but no startup-registered client ->
 *   muse_shopify_catalog_client_not_registered. Clients are
 *   registered only at server startup by the operator, never
 *   over HTTP, never from a request body, never the
 *   synthetic fixture.
 * - Company != authenticated principal's company ->
 *   provider_readiness_company_mismatch, before any call.
 * - Store domain missing -> muse_shopify_store_not_configured.
 *   There is never a default or shared store: the domain
 *   comes from the authenticated company's own manifest
 *   first, then SHOPIFY_STORE_DOMAIN, and only for that
 *   company. A store domain that is not a *.myshopify.com
 *   domain is a configuration error, never a fallback.
 * - Secrets are never read back, logged, or echoed: config
 *   returns presence booleans only.
 *
 * VALIDATION (same rules as meta-catalog.ts):
 * - Title, price, and currency are required and validated;
 *   stock is validated where returned. Price comes from the
 *   first variant's Money object (amount + currencyCode);
 *   a product with no variant price is unverifiable, never
 *   priced by guess.
 * - Freshness SLA is 24 hours, the same SLA as muse-bi.ts.
 *   An item carrying a timestamp older than 24 hours (or
 *   unparseable, or in the future) is unverifiable /
 *   refresh required — its price is never guessed and it is
 *   never presented as current. Items with no timestamp are
 *   stamped by the read itself (fetchedAt); the result
 *   carries validUntil = fetchedAt + 24h, after which a
 *   fresh read is required.
 * - A product that is not ACTIVE, or whose first variant is
 *   not available for sale, is valid but unavailable: it
 *   goes in the `unavailable` bucket, not `verified`.
 * - Consumer output strips raw provider IDs: only the
 *   resolved title, price, currency, and availability leave
 *   this module. Shopify product/variant IDs (gid://shopify/
 *   ...), handles, and store domains never appear in a
 *   ShopifyCatalogReadResult.
 */

export const SHOPIFY_CATALOG_DEFAULT_VERSION = '2025-07';
export const SHOPIFY_CATALOG_FRESHNESS_MS = 24 * 60 * 60 * 1000;
export const SHOPIFY_CATALOG_SOURCE_LABEL = 'SHOPIFY';
export const SHOPIFY_CATALOG_MODE_LABEL = 'TEST — development / test store';
export const SYNTHETIC_FIXTURE_COMPANY_ID = 'synthetic-fixture-demo-only';

const SHOPIFY_STORE_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export interface ShopifyCatalogConfig {
  storeDomain: string | null;
  version: string;
  tokenConfigured: boolean;
}

/** Presence-only view of the Shopify catalog environment. Never returns a token value. */
export function resolveShopifyCatalogConfig(env: NodeJS.ProcessEnv): ShopifyCatalogConfig {
  const rawDomain = env.SHOPIFY_STORE_DOMAIN?.trim() ?? '';
  const storeDomain = rawDomain ? rawDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '') : null;
  const version = env.SHOPIFY_API_VERSION?.trim() || SHOPIFY_CATALOG_DEFAULT_VERSION;
  if (storeDomain !== null && !SHOPIFY_STORE_DOMAIN_PATTERN.test(storeDomain)) {
    throw new Error('shopify_catalog_config_invalid');
  }
  if (!/^\d{4}-\d{2}$/.test(version)) {
    throw new Error('shopify_catalog_config_invalid');
  }
  return {
    storeDomain,
    version,
    tokenConfigured: Boolean(env.SHOPIFY_STOREFRONT_ACCESS_TOKEN?.trim()),
  };
}

/**
 * Store-domain resolution, in precedence order. A per-company
 * manifest store domain (the authenticated company's own store)
 * wins over the deployment-level SHOPIFY_STORE_DOMAIN; neither
 * is ever shared across companies, and a missing domain is null
 * — never a default store. The caller must already have matched
 * the manifest to the authenticated principal; readShopifyCatalog
 * enforces the tenant check.
 */
export function resolveShopifyStoreDomain(args: {
  envStoreDomain?: string;
  manifestStoreDomain?: string;
}): string | null {
  const manifest = args.manifestStoreDomain?.trim();
  if (manifest) return manifest;
  const envDomain = args.envStoreDomain?.trim();
  if (envDomain) return envDomain;
  return null;
}

/** The only transport this module knows: one query method, query operations only. */
export interface ShopifyCatalogTransport {
  query(document: string, variables: Record<string, unknown>): Promise<unknown>;
}

export type ShopifyCatalogFetchFn = (
  url: string,
  init: {method: 'POST'; headers: Record<string, string>; body: string},
) => Promise<{ok: boolean; status: number; json: () => Promise<unknown>}>;

/**
 * Storefront API transport. Uses fetch with a JSON body carrying
 * a query document only; the token travels in the
 * X-Shopify-Storefront-Access-Token header only (never in the
 * URL). A document that is not a pure query operation is
 * rejected before any network call. Non-OK responses,
 * GraphQL `errors`, and non-object bodies fail closed; they
 * are never turned into data.
 */
export function createShopifyStorefrontTransport(args: {
  storeDomain: string;
  version: string;
  token: string;
  fetchImpl: ShopifyCatalogFetchFn;
}): ShopifyCatalogTransport {
  const storeDomain = args.storeDomain?.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const token = args.token?.trim();
  if (!storeDomain || !SHOPIFY_STORE_DOMAIN_PATTERN.test(storeDomain)) {
    throw new Error('shopify_catalog_config_invalid');
  }
  if (!token) throw new Error('muse_shopify_catalog_not_configured');
  if (!/^\d{4}-\d{2}$/.test(args.version)) throw new Error('shopify_catalog_config_invalid');
  const url = `https://${storeDomain}/api/${args.version}/graphql.json`;
  return {
    async query(document: string, variables: Record<string, unknown>): Promise<unknown> {
      const trimmed = document.trim();
      if (!/^query\b/.test(trimmed) || /\bmutation\b|\bsubscription\b/.test(trimmed)) {
        throw new Error('muse_shopify_query_not_readonly');
      }
      const response = await args.fetchImpl(url, {
        method: 'POST',
        headers: {
          'X-Shopify-Storefront-Access-Token': token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({query: document, variables}),
      });
      if (!response.ok) throw new Error('muse_shopify_graph_error');
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('muse_shopify_graph_response_invalid');
      }
      const record = data as Record<string, unknown>;
      if (Array.isArray(record.errors) && record.errors.length > 0) {
        throw new Error('muse_shopify_graph_error');
      }
      if (!record.data || typeof record.data !== 'object' || Array.isArray(record.data)) {
        throw new Error('muse_shopify_graph_response_invalid');
      }
      return record.data;
    },
  };
}

const SHOPIFY_PRODUCTS_QUERY = `query ShopifyCatalogProducts($first: Int) {
  products(first: $first) {
    edges {
      node {
        id
        title
        handle
        updatedAt
        status
        variants(first: 1) {
          edges {
            node {
              id
              price { amount currencyCode }
              availableForSale
            }
          }
        }
      }
    }
  }
}`;

const SHOPIFY_PRODUCT_QUERY = `query ShopifyCatalogProduct($handle: String!) {
  productByHandle(handle: $handle) {
    id
    title
    handle
    updatedAt
    status
    variants(first: 1) {
      edges {
        node {
          id
          price { amount currencyCode }
          availableForSale
        }
      }
    }
  }
}`;

/** Read-only client interface: exactly two product reads, nothing else. */
export interface ShopifyCatalogClient {
  fetchProducts(first?: number): Promise<unknown>;
  fetchProduct(handle: string): Promise<unknown>;
}

export function createShopifyCatalogClient(args: {
  transport: ShopifyCatalogTransport;
}): ShopifyCatalogClient {
  return {
    fetchProducts: (first = 25) => args.transport.query(SHOPIFY_PRODUCTS_QUERY, {first}),
    fetchProduct: (handle: string) => {
      const trimmed = handle?.trim();
      if (!trimmed) throw new Error('muse_shopify_product_handle_required');
      return args.transport.query(SHOPIFY_PRODUCT_QUERY, {handle: trimmed});
    },
  };
}

// --- Startup-only client registry ---------------------------------------
// Populated only by server startup code (the operator's deployment
// wrapper), never by a request handler. By default the registry is
// empty and every read fails closed. Tests inject clients directly
// into readShopifyCatalog, never through this registry.
let shopifyCatalogClient: ShopifyCatalogClient | null = null;

export function registerShopifyCatalogClient(client: ShopifyCatalogClient): void {
  shopifyCatalogClient = client;
}

export function getShopifyCatalogClient(): ShopifyCatalogClient | null {
  return shopifyCatalogClient;
}

// --- Validation ----------------------------------------------------------

export interface ShopifyCatalogConsumerItem {
  title: string;
  priceAmount: number;
  currency: string;
  availability: string;
  status: 'verified' | 'unavailable';
}

export interface ShopifyCatalogUnverifiableItem {
  title: string | null;
  reason: string;
}

export interface ShopifyCatalogReadResult {
  source: 'SHOPIFY';
  label: string;
  fetchedAt: string;
  validUntil: string;
  refreshRequired: boolean;
  verified: ShopifyCatalogConsumerItem[];
  unavailable: ShopifyCatalogConsumerItem[];
  unverifiable: ShopifyCatalogUnverifiableItem[];
}

function boundedTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  if (!title || title.length > 200) return null;
  return title;
}

function parseVariantPrice(node: Record<string, unknown>): {amount: number; currency: string} | null {
  const variants = node.variants;
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return null;
  const edges = (variants as Record<string, unknown>).edges;
  if (!Array.isArray(edges) || edges.length === 0) return null;
  const variant = edges[0];
  if (!variant || typeof variant !== 'object' || Array.isArray(variant)) return null;
  const variantNode = (variant as Record<string, unknown>).node;
  if (!variantNode || typeof variantNode !== 'object' || Array.isArray(variantNode)) return null;
  const price = (variantNode as Record<string, unknown>).price;
  if (!price || typeof price !== 'object' || Array.isArray(price)) return null;
  const priceRecord = price as Record<string, unknown>;
  const amountRaw = priceRecord.amount;
  const amount = typeof amountRaw === 'number' ? amountRaw : typeof amountRaw === 'string' && /^\d+(?:\.\d+)?$/.test(amountRaw.trim()) ? Number(amountRaw.trim()) : null;
  const currencyRaw = priceRecord.currencyCode;
  const currency = typeof currencyRaw === 'string' && /^[A-Z]{3}$/.test(currencyRaw.trim().toUpperCase()) ? currencyRaw.trim().toUpperCase() : null;
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  if (currency === null) return null;
  return {amount, currency};
}

function variantAvailable(node: Record<string, unknown>): boolean | null {
  const variants = node.variants;
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return null;
  const edges = (variants as Record<string, unknown>).edges;
  if (!Array.isArray(edges) || edges.length === 0) return null;
  const variant = edges[0];
  if (!variant || typeof variant !== 'object' || Array.isArray(variant)) return null;
  const variantNode = (variant as Record<string, unknown>).node;
  if (!variantNode || typeof variantNode !== 'object' || Array.isArray(variantNode)) return null;
  const available = (variantNode as Record<string, unknown>).availableForSale;
  return typeof available === 'boolean' ? available : null;
}

function parseItemTimestamp(node: Record<string, unknown>): number | null | 'unparseable' {
  const raw = node.updatedAt ?? node.updated_at;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return 'unparseable';
  const ms = Date.parse(typeof raw === 'number' ? new Date(raw).toISOString() : raw);
  if (Number.isNaN(ms)) return 'unparseable';
  return ms;
}

function classifyNode(node: unknown, nowMs: number): {verified?: ShopifyCatalogConsumerItem; unavailable?: ShopifyCatalogConsumerItem; unverifiable?: ShopifyCatalogUnverifiableItem} {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return {unverifiable: {title: null, reason: 'invalid_item'}};
  }
  const record = node as Record<string, unknown>;
  const title = boundedTitle(record.title);
  if (!title) return {unverifiable: {title: null, reason: 'invalid_title'}};
  const price = parseVariantPrice(record);
  if (!price) return {unverifiable: {title, reason: 'invalid_price'}};
  const timestamp = parseItemTimestamp(record);
  if (timestamp === 'unparseable') {
    return {unverifiable: {title, reason: 'invalid_timestamp'}};
  }
  if (timestamp !== null && (timestamp > nowMs || nowMs - timestamp > SHOPIFY_CATALOG_FRESHNESS_MS)) {
    return {unverifiable: {title, reason: 'stale'}};
  }
  const status = typeof record.status === 'string' ? record.status.trim().toUpperCase() : null;
  const available = variantAvailable(record);
  const availability = available === false ? 'out of stock' : 'in stock';
  if (status !== null && status !== 'ACTIVE') {
    return {unavailable: {title, priceAmount: price.amount, currency: price.currency, availability, status: 'unavailable'}};
  }
  if (available === false) {
    return {unavailable: {title, priceAmount: price.amount, currency: price.currency, availability, status: 'unavailable'}};
  }
  return {verified: {title, priceAmount: price.amount, currency: price.currency, availability, status: 'verified'}};
}

function edgesOf(data: unknown): unknown[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('muse_shopify_response_invalid');
  const products = (data as Record<string, unknown>).products;
  if (!products || typeof products !== 'object' || Array.isArray(products)) throw new Error('muse_shopify_response_invalid');
  const edges = (products as Record<string, unknown>).edges;
  if (!Array.isArray(edges)) throw new Error('muse_shopify_response_invalid');
  return edges.map((edge) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) throw new Error('muse_shopify_response_invalid');
    return (edge as Record<string, unknown>).node;
  });
}

/**
 * Internal helper — the narrowest API surface for a Shopify
 * catalog read. No route is added in this change: a future
 * route, if one is ever added, must authenticate the
 * principal, pass that principal's companyId as both
 * companyId and principalCompanyId, resolve the store domain
 * from that company's own manifest (or SHOPIFY_STORE_DOMAIN),
 * and label its output READ-ONLY with source SHOPIFY and the
 * TEST label below until a real read is verified. This helper
 * itself never renders a review, signs a draft, issues an
 * approval, or executes a purchase, and it consumes no
 * approval. It never touches a cart, a checkout, an order,
 * or a customer record.
 */
export async function readShopifyCatalog(args: {
  config: ShopifyCatalogConfig;
  client: ShopifyCatalogClient | null;
  companyId: string;
  principalCompanyId: string;
  manifestStoreDomain?: string | null;
  envStoreDomain?: string | null;
  now?: string;
}): Promise<ShopifyCatalogReadResult> {
  if (!args.config.tokenConfigured) throw new Error('muse_shopify_catalog_not_configured');
  if (!args.client) throw new Error('muse_shopify_catalog_client_not_registered');
  const companyId = args.companyId?.trim();
  if (!companyId || companyId !== args.principalCompanyId?.trim()) {
    throw new Error('provider_readiness_company_mismatch');
  }
  if (companyId === SYNTHETIC_FIXTURE_COMPANY_ID) throw new Error('muse_shopify_catalog_company_invalid');
  const storeDomainRaw = resolveShopifyStoreDomain({
    envStoreDomain: args.envStoreDomain ?? args.config.storeDomain ?? undefined,
    manifestStoreDomain: args.manifestStoreDomain ?? undefined,
  });
  const storeDomain = storeDomainRaw?.replace(/^https?:\/\//i, '').replace(/\/+$/, '') ?? null;
  if (!storeDomain) throw new Error('muse_shopify_store_not_configured');
  if (!SHOPIFY_STORE_DOMAIN_PATTERN.test(storeDomain)) throw new Error('shopify_catalog_config_invalid');
  const fetchedAt = args.now ?? new Date().toISOString();
  const nowMs = Date.parse(fetchedAt);
  if (Number.isNaN(nowMs)) throw new Error('shopify_catalog_read_time_invalid');
  const raw = await args.client.fetchProducts();
  const nodes = edgesOf(raw);
  const result: ShopifyCatalogReadResult = {
    source: SHOPIFY_CATALOG_SOURCE_LABEL,
    label: SHOPIFY_CATALOG_MODE_LABEL,
    fetchedAt,
    validUntil: new Date(nowMs + SHOPIFY_CATALOG_FRESHNESS_MS).toISOString(),
    refreshRequired: false,
    verified: [],
    unavailable: [],
    unverifiable: [],
  };
  for (const node of nodes) {
    const classified = classifyNode(node, nowMs);
    if (classified.verified) result.verified.push(classified.verified);
    else if (classified.unavailable) result.unavailable.push(classified.unavailable);
    else if (classified.unverifiable) result.unverifiable.push(classified.unverifiable);
  }
  result.refreshRequired = result.unverifiable.length > 0;
  return result;
}

/**
 * Single-product read through the same gates as
 * readShopifyCatalog. Returns null when the handle does not
 * resolve to a product; a resolved product is classified with
 * the same title/price/currency/freshness rules, and its raw
 * IDs and handle never leave this module.
 */
export async function readShopifyProduct(args: {
  config: ShopifyCatalogConfig;
  client: ShopifyCatalogClient | null;
  companyId: string;
  principalCompanyId: string;
  manifestStoreDomain?: string | null;
  envStoreDomain?: string | null;
  handle: string;
  now?: string;
}): Promise<ShopifyCatalogConsumerItem | ShopifyCatalogUnverifiableItem | null> {
  if (!args.config.tokenConfigured) throw new Error('muse_shopify_catalog_not_configured');
  if (!args.client) throw new Error('muse_shopify_catalog_client_not_registered');
  const companyId = args.companyId?.trim();
  if (!companyId || companyId !== args.principalCompanyId?.trim()) {
    throw new Error('provider_readiness_company_mismatch');
  }
  if (companyId === SYNTHETIC_FIXTURE_COMPANY_ID) throw new Error('muse_shopify_catalog_company_invalid');
  const storeDomainRaw = resolveShopifyStoreDomain({
    envStoreDomain: args.envStoreDomain ?? args.config.storeDomain ?? undefined,
    manifestStoreDomain: args.manifestStoreDomain ?? undefined,
  });
  const storeDomain = storeDomainRaw?.replace(/^https?:\/\//i, '').replace(/\/+$/, '') ?? null;
  if (!storeDomain) throw new Error('muse_shopify_store_not_configured');
  if (!SHOPIFY_STORE_DOMAIN_PATTERN.test(storeDomain)) throw new Error('shopify_catalog_config_invalid');
  const fetchedAt = args.now ?? new Date().toISOString();
  const nowMs = Date.parse(fetchedAt);
  if (Number.isNaN(nowMs)) throw new Error('shopify_catalog_read_time_invalid');
  const raw = await args.client.fetchProduct(args.handle);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('muse_shopify_response_invalid');
  const node = (raw as Record<string, unknown>).productByHandle;
  if (node === null || node === undefined) return null;
  const classified = classifyNode(node, nowMs);
  if (classified.verified) return classified.verified;
  if (classified.unavailable) return classified.unavailable;
  return classified.unverifiable ?? null;
}
