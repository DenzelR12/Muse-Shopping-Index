/**
 * Read-only Meta catalog client — Muse Shopping Index.
 *
 * Hierarchy: Muse Shopping Index is the parent project; `muse shop index`
 * is the Meta for Developers app inside it, with the Catalog API use case
 * added and the `catalog_management` permission Ready for testing.
 *
 * READ-ONLY BY CONSTRUCTION:
 * - The only transport method is GET. There is no POST, PUT, DELETE, or
 *   PATCH method anywhere in this module, no write endpoint is ever
 *   called, and the client interface exposes exactly two reads:
 *   fetchCatalog (catalog details) and fetchProducts (catalog products).
 * - `catalog_management` in Meta's definition allows create, read,
 *   update, and delete of business-owned catalogs. This client uses
 *   only the read part of that scope, in code: a write cannot be
 *   expressed through this module, it can only be added by writing
 *   new code, which this module's review rule forbids.
 * - This client renders no review, signs no draft, issues no approval,
 *   and executes no purchase. It is an internal helper (see
 *   readMetaCatalog); there is deliberately no public purchase route
 *   and no new public route at all in this change.
 *
 * ENDPOINTS (Meta Graph API, versioned, graph.facebook.com base):
 * - GET {base}/{version}/{catalogId}
 * - GET {base}/{version}/{catalogId}/products
 * Base and version come from META_GRAPH_API_BASE_URL and
 * META_GRAPH_API_VERSION, defaulting to https://graph.facebook.com and
 * v26.0. v26.0 is the latest Graph API version announced by Meta on
 * 2026-07-29 (Meta developer blog, "Introducing Graph API v26.0 and
 * Marketing API v26.0"); the catalog reference page itself returned
 * 403 to a plain text fetch, so the catalog node/products edge shape
 * is the standard Graph API node/edge pattern and is NOT live-verified
 * against a real catalog by this change. No live catalog read, live
 * seller, App Review, or Business Verification is claimed anywhere
 * here (see docs/meta-catalog-client.md).
 *
 * GATING (same fail-closed pattern as live-activation.ts):
 * - META_CATALOG_ACCESS_TOKEN missing -> muse_catalog_not_configured,
 *   no approval consumed, no network call.
 * - Token present but no startup-registered client -> 
 *   muse_catalog_client_not_registered, no network call. Clients are
 *   registered only at server startup by the operator, never over
 *   HTTP, never from a request body, never the synthetic fixture.
 * - Catalog ID missing -> muse_catalog_id_not_configured. There is
 *   never a default catalog: the ID comes from META_CATALOG_ID or
 *   from the authenticated company's own manifest, never a catalog
 *   shared across companies.
 * - Tenant rule: a read is only ever for the authenticated company's
 *   own catalog. companyId != principalCompanyId ->
 *   provider_readiness_company_mismatch (the existing readiness
 *   error name), before any network call.
 * - Secrets are never read back, logged, or echoed: config returns
 *   presence booleans only. The token travels only in an
 *   Authorization header, never in a URL query string.
 *
 * VALIDATION (existing catalog rules, cf. catalogItemSchema and the
 * 24-hour freshness rule in the source catalog work):
 * - Title (title, or name), price, and currency are required and
 *   validated; availability/stock is validated where returned.
 * - Freshness SLA is 24 hours, the same SLA as muse-bi.ts
 *   DEFAULT_FRESHNESS_SLA_MS. An item carrying a timestamp older
 *   than 24 hours (or unparseable, or in the future) is
 *   unverifiable / refresh required — its price is never guessed
 *   and it is never presented as current. Items with no timestamp
 *   are stamped by the read itself (fetchedAt); the result carries
 *   validUntil = fetchedAt + 24h, after which a fresh read is
 *   required.
 * - Consumer output strips raw provider IDs: only the resolved
 *   display name/title, price, currency, and availability leave
 *   this module. Provider catalog/product/retailer IDs never appear
 *   in a MetaCatalogReadResult.
 */

export const META_CATALOG_DEFAULT_BASE_URL = 'https://graph.facebook.com';
export const META_CATALOG_DEFAULT_VERSION = 'v26.0';
export const META_CATALOG_FRESHNESS_MS = 24 * 60 * 60 * 1000;
export const META_CATALOG_SOURCE_LABEL = 'META CATALOG';
export const META_CATALOG_MODE_LABEL = 'TEST — Development Mode / test catalog';
export const SYNTHETIC_FIXTURE_COMPANY_ID = 'synthetic-fixture-demo-only';

const KNOWN_AVAILABILITY = new Set([
  'in stock',
  'out of stock',
  'preorder',
  'available for order',
]);

export interface MetaCatalogConfig {
  baseUrl: string;
  version: string;
  tokenConfigured: boolean;
}

/** Presence-only view of the Meta catalog environment. Never returns a token value. */
export function resolveMetaCatalogConfig(env: NodeJS.ProcessEnv): MetaCatalogConfig {
  const baseUrl = (env.META_GRAPH_API_BASE_URL?.trim() || META_CATALOG_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const version = env.META_GRAPH_API_VERSION?.trim() || META_CATALOG_DEFAULT_VERSION;
  if (!baseUrl.startsWith('https://') || !/^v\d+\.\d+$/.test(version)) {
    throw new Error('meta_catalog_config_invalid');
  }
  return {
    baseUrl,
    version,
    tokenConfigured: Boolean(env.META_CATALOG_ACCESS_TOKEN?.trim()),
  };
}

/**
 * Catalog-ID resolution, in precedence order. A per-company manifest
 * catalog ID (the authenticated company's own catalog) wins over the
 * deployment-level META_CATALOG_ID; neither is ever shared across
 * companies, and a missing ID is null — never a default catalog.
 * The caller must already have matched the manifest to the
 * authenticated principal; readMetaCatalog enforces the tenant check.
 */
export function resolveMetaCatalogId(args: {
  envCatalogId?: string;
  manifestCatalogId?: string;
}): string | null {
  const manifest = args.manifestCatalogId?.trim();
  if (manifest) return manifest;
  const envId = args.envCatalogId?.trim();
  if (envId) return envId;
  return null;
}

/** The only transport this module knows: one GET method. */
export interface MetaCatalogTransport {
  get(url: string): Promise<unknown>;
}

export type MetaCatalogFetchFn = (
  url: string,
  init: {method: 'GET'; headers: Record<string, string>},
) => Promise<{ok: boolean; status: number; json: () => Promise<unknown>}>;

/**
 * Graph API transport. Uses fetch with method 'GET' only, token in an
 * Authorization header only (never in the URL). Non-OK responses and
 * non-object bodies fail closed; they are never turned into data.
 */
export function createMetaCatalogGraphTransport(args: {
  baseUrl: string;
  version: string;
  token: string;
  fetchImpl: MetaCatalogFetchFn;
}): MetaCatalogTransport {
  const token = args.token?.trim();
  if (!token) throw new Error('muse_catalog_not_configured');
  return {
    async get(url: string): Promise<unknown> {
      const response = await args.fetchImpl(url, {
        method: 'GET',
        headers: {Authorization: `Bearer ${token}`, Accept: 'application/json'},
      });
      if (!response.ok) throw new Error('muse_catalog_graph_error');
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('muse_catalog_graph_response_invalid');
      }
      return data;
    },
  };
}

/** Read-only client interface: exactly two GET reads, nothing else. */
export interface MetaCatalogClient {
  fetchCatalog(catalogId: string): Promise<unknown>;
  fetchProducts(catalogId: string): Promise<unknown>;
}

export function createMetaCatalogClient(args: {
  transport: MetaCatalogTransport;
  baseUrl: string;
  version: string;
}): MetaCatalogClient {
  const baseUrl = args.baseUrl.replace(/\/+$/, '');
  if (!baseUrl.startsWith('https://') || !/^v\d+\.\d+$/.test(args.version)) {
    throw new Error('meta_catalog_config_invalid');
  }
  const urlFor = (catalogId: string, suffix: string): string => {
    const id = catalogId?.trim();
    if (!id) throw new Error('muse_catalog_id_not_configured');
    return `${baseUrl}/${args.version}/${encodeURIComponent(id)}${suffix}`;
  };
  return {
    fetchCatalog: (catalogId: string) => args.transport.get(urlFor(catalogId, '')),
    fetchProducts: (catalogId: string) => args.transport.get(urlFor(catalogId, '/products')),
  };
}

// --- Startup-only client registry ---------------------------------------
// Populated only by server startup code (the operator's deployment
// wrapper), never by a request handler. By default the registry is
// empty and every read fails closed. Tests inject clients directly
// into readMetaCatalog, never through this registry.
let metaCatalogClient: MetaCatalogClient | null = null;

export function registerMetaCatalogClient(client: MetaCatalogClient): void {
  metaCatalogClient = client;
}

export function getMetaCatalogClient(): MetaCatalogClient | null {
  return metaCatalogClient;
}

// --- Validation ----------------------------------------------------------

export interface MetaCatalogConsumerItem {
  title: string;
  priceAmount: number;
  currency: string;
  availability: string;
  status: 'verified' | 'unavailable';
}

export interface MetaCatalogUnverifiableItem {
  title: string | null;
  reason: string;
}

export interface MetaCatalogReadResult {
  source: 'META CATALOG';
  label: string;
  catalogName: string;
  fetchedAt: string;
  validUntil: string;
  refreshRequired: boolean;
  verified: MetaCatalogConsumerItem[];
  unavailable: MetaCatalogConsumerItem[];
  unverifiable: MetaCatalogUnverifiableItem[];
}

function boundedTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  if (!title || title.length > 200) return null;
  return title;
}

function parsePrice(rawPrice: unknown, rawCurrency: unknown): {amount: number; currency: string} | null {
  let amount: number | null = null;
  let currency: string | null = null;
  if (typeof rawPrice === 'string') {
    const withCurrency = /^(\d+(?:\.\d+)?)\s+([A-Za-z]{3})$/.exec(rawPrice.trim());
    if (withCurrency) {
      amount = Number(withCurrency[1]);
      currency = withCurrency[2].toUpperCase();
    } else if (/^\d+(?:\.\d+)?$/.test(rawPrice.trim())) {
      amount = Number(rawPrice.trim());
    }
  } else if (typeof rawPrice === 'number') {
    amount = rawPrice;
  } else if (rawPrice && typeof rawPrice === 'object') {
    const obj = rawPrice as Record<string, unknown>;
    const inner = obj.amount;
    if (typeof inner === 'number') amount = inner;
    else if (typeof inner === 'string' && /^\d+(?:\.\d+)?$/.test(inner.trim())) amount = Number(inner.trim());
    if (typeof obj.currency === 'string') currency = obj.currency.trim().toUpperCase();
  }
  if (currency === null && typeof rawCurrency === 'string') {
    const candidate = rawCurrency.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(candidate)) currency = candidate;
  }
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  if (currency === null || !/^[A-Z]{3}$/.test(currency)) return null;
  return {amount, currency};
}

function parseItemTimestamp(item: Record<string, unknown>): number | null | 'unparseable' {
  const raw = item.updated_time ?? item.updatedAt ?? item.last_updated;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return 'unparseable';
  const ms = Date.parse(typeof raw === 'number' ? new Date(raw).toISOString() : raw);
  if (Number.isNaN(ms)) return 'unparseable';
  return ms;
}

function classifyItem(item: unknown, nowMs: number): {verified?: MetaCatalogConsumerItem; unavailable?: MetaCatalogConsumerItem; unverifiable?: MetaCatalogUnverifiableItem} {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return {unverifiable: {title: null, reason: 'invalid_item'}};
  }
  const record = item as Record<string, unknown>;
  const title = boundedTitle(record.title ?? record.name);
  if (!title) return {unverifiable: {title: null, reason: 'invalid_title'}};
  const price = parsePrice(record.price, record.currency);
  if (!price) return {unverifiable: {title, reason: 'invalid_price'}};
  let availability = 'unknown';
  if (record.availability !== undefined && record.availability !== null) {
    if (typeof record.availability !== 'string') {
      return {unverifiable: {title, reason: 'invalid_availability'}};
    }
    const normalized = record.availability.trim().toLowerCase().replace(/_/g, ' ');
    if (!KNOWN_AVAILABILITY.has(normalized)) {
      return {unverifiable: {title, reason: 'invalid_availability'}};
    }
    availability = normalized;
  }
  const timestamp = parseItemTimestamp(record);
  if (timestamp === 'unparseable') {
    return {unverifiable: {title, reason: 'invalid_timestamp'}};
  }
  if (timestamp !== null && (timestamp > nowMs || nowMs - timestamp > META_CATALOG_FRESHNESS_MS)) {
    return {unverifiable: {title, reason: 'stale'}};
  }
  const consumer: MetaCatalogConsumerItem = {
    title,
    priceAmount: price.amount,
    currency: price.currency,
    availability,
    status: availability === 'out of stock' ? 'unavailable' : 'verified',
  };
  return availability === 'out of stock' ? {unavailable: consumer} : {verified: consumer};
}

/**
 * Internal helper — the narrowest API surface for a Meta catalog read.
 * No route is added in this change: a future route, if one is ever
 * added, must authenticate the principal, pass that principal's
 * companyId as both companyId and principalCompanyId, resolve the
 * catalog ID from that company's own manifest (or META_CATALOG_ID),
 * and label its output READ-ONLY with source META CATALOG and the
 * TEST label below until a real read is verified. This helper itself
 * never renders a review, signs a draft, issues an approval, or
 * executes a purchase, and it consumes no approval.
 */
export async function readMetaCatalog(args: {
  config: MetaCatalogConfig;
  client: MetaCatalogClient | null;
  companyId: string;
  principalCompanyId: string;
  catalogId: string | null | undefined;
  now?: string;
}): Promise<MetaCatalogReadResult> {
  if (!args.config.tokenConfigured) throw new Error('muse_catalog_not_configured');
  if (!args.client) throw new Error('muse_catalog_client_not_registered');
  const companyId = args.companyId?.trim();
  if (!companyId || companyId !== args.principalCompanyId?.trim()) {
    throw new Error('provider_readiness_company_mismatch');
  }
  if (companyId === SYNTHETIC_FIXTURE_COMPANY_ID) throw new Error('muse_catalog_company_invalid');
  const catalogId = args.catalogId?.trim();
  if (!catalogId) throw new Error('muse_catalog_id_not_configured');
  const fetchedAt = args.now ?? new Date().toISOString();
  const nowMs = Date.parse(fetchedAt);
  if (Number.isNaN(nowMs)) throw new Error('meta_catalog_read_time_invalid');
  const rawCatalog = await args.client.fetchCatalog(catalogId);
  if (!rawCatalog || typeof rawCatalog !== 'object' || Array.isArray(rawCatalog)) {
    throw new Error('muse_catalog_response_invalid');
  }
  const catalogRecord = rawCatalog as Record<string, unknown>;
  const catalogName = boundedTitle(catalogRecord.name) ?? 'Meta catalog';
  const rawProducts = await args.client.fetchProducts(catalogId);
  if (!rawProducts || typeof rawProducts !== 'object' || Array.isArray(rawProducts)) {
    throw new Error('muse_catalog_response_invalid');
  }
  const data = (rawProducts as Record<string, unknown>).data;
  if (!Array.isArray(data)) throw new Error('muse_catalog_response_invalid');
  const result: MetaCatalogReadResult = {
    source: META_CATALOG_SOURCE_LABEL,
    label: META_CATALOG_MODE_LABEL,
    catalogName,
    fetchedAt,
    validUntil: new Date(nowMs + META_CATALOG_FRESHNESS_MS).toISOString(),
    refreshRequired: false,
    verified: [],
    unavailable: [],
    unverifiable: [],
  };
  for (const item of data) {
    const classified = classifyItem(item, nowMs);
    if (classified.verified) result.verified.push(classified.verified);
    else if (classified.unavailable) result.unavailable.push(classified.unavailable);
    else if (classified.unverifiable) result.unverifiable.push(classified.unverifiable);
  }
  result.refreshRequired = result.unverifiable.length > 0;
  return result;
}
