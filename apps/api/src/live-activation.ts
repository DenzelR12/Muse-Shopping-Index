import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {
  validateMetaBusinessVerification,
  type MetaBusinessVerification,
} from '@gift-signal/mcp-gateway';
import {
  applyBiIngestionResult,
  parseSuppliedBiEvents,
  type BiEventStore,
  type BiWatermarkStore,
} from './muse-bi.js';
import {
  resolveShopPayExecutionConfig,
  type ShopPayExecutionClient,
  type ShopPayExecutionConfig,
} from './shop-pay-vehicle.js';

/**
 * Live activation points — the code that makes "credentials in" the
 * only remaining step for the paths below, without inventing any
 * external API, endpoint, or approval.
 *
 * Principle, repeated for every path in this module:
 * - A path is DISABLED (fail closed, no approval consumed, no fake
 *   success) when its credential/config is absent.
 * - A path is ENABLED only when its credential/config is present
 *   AND a client/adapter for it has been registered at server
 *   startup by the operator. Clients are never registered over
 *   HTTP, never from a request body, and never the synthetic
 *   fixture. The operator's client is their pre-existing authorized
 *   integration (their Shop Pay checkout client, their Meta Ads API
 *   client, their provider adapter); this repo deliberately does
 *   NOT invent a Shop Pay API endpoint, a Meta Graph API call, or a
 *   provider API shape, because a guessed shape would fail — or
 *   worse, appear to succeed — against the real service.
 * - Secrets are never read back, logged, or echoed: this module
 *   returns presence booleans only. Values live in the deployment
 *   secret manager, never in the repo, chat, logs, or tests.
 * - Nothing here grants Meta distribution approval, Shop
 *   partnership, or a live payment: those remain external approvals
 *   (see docs/live-readiness.md), listed separately from
 *   credentials, not hidden behind a credential name.
 */

export const SYNTHETIC_FIXTURE_COMPANY_ID = 'synthetic-fixture-demo-only';

export interface LiveActivationConfig {
  shopPay: ShopPayExecutionConfig;
  metaVerificationRecording: {secretConfigured: boolean};
  metaAds: {tokenConfigured: boolean; accountConfigured: boolean; ready: boolean};
  reelEntry: {secretConfigured: boolean};
  genericAdapters: {configPresent: boolean; companyIds: string[]};
}

/** Presence-only view of the live activation environment. */
export function resolveLiveActivationConfig(
  env: NodeJS.ProcessEnv
): LiveActivationConfig {
  const shopPay = resolveShopPayExecutionConfig(env);
  const metaAdsToken = Boolean(env.META_ADS_ACCESS_TOKEN?.trim());
  const metaAdsAccount = Boolean(env.META_ADS_ACCOUNT_ID?.trim());
  let genericCompanyIds: string[] = [];
  try {
    genericCompanyIds = Object.keys(parseGenericAdapterConfig(env.MUSE_GENERIC_ADAPTER_CONFIG_JSON));
  } catch {
    genericCompanyIds = [];
  }
  return {
    shopPay,
    metaVerificationRecording: {
      secretConfigured: Boolean(env.META_VERIFICATION_WEBHOOK_SECRET?.trim()),
    },
    metaAds: {
      tokenConfigured: metaAdsToken,
      accountConfigured: metaAdsAccount,
      ready: metaAdsToken && metaAdsAccount,
    },
    reelEntry: {
      secretConfigured: Boolean(env.META_REEL_CALLBACK_SIGNING_SECRET?.trim()),
    },
    genericAdapters: {
      configPresent: genericCompanyIds.length > 0,
      companyIds: genericCompanyIds,
    },
  };
}

/** HMAC-SHA256 verification for trusted callbacks (Meta-style
 *  webhooks). Signature header format: `sha256=<hex>`. Returns false
 *  on missing/malformed secret, header, or digest — never throws on
 *  attacker-controlled input. */
export function verifyHmacSha256Signature(args: {
  secret: string;
  rawBody: Buffer;
  signatureHeader: string | undefined;
}): boolean {
  if (!args.secret || !args.signatureHeader) return false;
  const match = /^sha256=([0-9a-fA-F]+)$/.exec(args.signatureHeader.trim());
  if (!match) return false;
  const expected = createHmac('sha256', args.secret).update(args.rawBody).digest();
  const actual = Buffer.from(match[1], 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`live_activation_${field}_invalid`);
  }
  return value.trim();
}

/**
 * Startup config for generic adapters: a JSON object mapping
 * companyId -> adapterId, from MUSE_GENERIC_ADAPTER_CONFIG_JSON.
 * This declares WHICH operator adapter serves WHICH company; it does
 * not create an adapter, and it never registers one over HTTP. A
 * company in this map without a startup-registered adapter still
 * fails closed at submit time with
 * muse_generic_connector_not_registered, and no approval is consumed.
 * The synthetic fixture companyId is rejected here, as everywhere.
 */
export function parseGenericAdapterConfig(
  raw: string | undefined
): Record<string, string> {
  if (!raw || !raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('live_activation_generic_adapter_config_invalid');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('live_activation_generic_adapter_config_invalid');
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > 100) {
    throw new Error('live_activation_generic_adapter_config_invalid');
  }
  const out: Record<string, string> = {};
  for (const [companyId, adapterId] of entries) {
    if (!companyId.trim() || companyId === SYNTHETIC_FIXTURE_COMPANY_ID) {
      throw new Error('live_activation_generic_adapter_config_invalid');
    }
    out[companyId.trim()] = boundedString(adapterId, 'generic_adapter_id', 160);
  }
  return out;
}

// --- Startup-only client registries -------------------------------------
// These are populated only by server startup code (the operator's
// deployment wrapper), never by a request handler. The API server's
// own index.ts registers nothing: by default every registry is
// empty, and every gated path fails closed. Tests inject clients
// directly into the functions below, never through these registries.

let shopPayExecutionClient: ShopPayExecutionClient | null = null;
let metaAdsClient: MetaAdsClient | null = null;

export function registerShopPayExecutionClient(client: ShopPayExecutionClient): void {
  shopPayExecutionClient = client;
}
export function getShopPayExecutionClient(): ShopPayExecutionClient | null {
  return shopPayExecutionClient;
}
export interface MetaAdsClient {
  /** Read-only fetch of funnel events for ONE company. The client
   *  must never change campaigns, budgets, routing, ranking, or
   *  policy, and must never return another company's events: the
   *  ingestion below drops any other-tenant event it receives. */
  fetchEvents(args: {companyId: string}): Promise<unknown[]>;
}
export function registerMetaAdsClient(client: MetaAdsClient): void {
  metaAdsClient = client;
}
export function getMetaAdsClient(): MetaAdsClient | null {
  return metaAdsClient;
}

// --- Meta business-verification recording --------------------------------
// Trusted recording route input validation. The route itself (in
// index.ts) additionally requires an authenticated company principal
// with manage_provider_connections, and the payload companyId must
// equal that principal. This function validates the webhook
// signature and the evidence record itself, using the existing
// evidence rules: missing, placeholder, self-attested, future, or
// expired evidence is rejected, and the legacy flag (when present)
// must agree with the evidence (verified evidence with a false
// flag is a mismatch, not a recording).

export function validateMetaVerificationRecording(args: {
  secret: string;
  rawBody: Buffer;
  signatureHeader: string | undefined;
}): {companyId: string; origin: 'meta'; metaVerification: MetaBusinessVerification} {
  if (!args.secret) throw new Error('meta_verification_recording_disabled');
  if (!verifyHmacSha256Signature({secret: args.secret, rawBody: args.rawBody, signatureHeader: args.signatureHeader})) {
    throw new Error('meta_verification_signature_invalid');
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(args.rawBody.toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('meta_verification_payload_invalid');
  }
  const companyId = boundedString((body as Record<string, unknown>).companyId, 'meta_verification_company_id', 160);
  const origin = (body as Record<string, unknown>).origin;
  if (origin !== undefined && origin !== 'meta') {
    throw new Error('meta_verification_origin_invalid');
  }
  const flag = (body as Record<string, unknown>).metaBusinessVerified;
  if (flag !== undefined && flag !== true) {
    throw new Error('meta_verification_flag_evidence_mismatch');
  }
  const metaVerification = (body as Record<string, unknown>).metaVerification as MetaBusinessVerification;
  const checked = validateMetaBusinessVerification(metaVerification);
  if (!checked.valid) throw new Error(checked.reason);
  return {companyId, origin: 'meta', metaVerification};
}

// --- Native Reel entry ----------------------------------------------------
// A trusted Reel callback intent. This creates NO draft, NO approval,
// and NO execution: it only normalizes a signature-verified intent
// that the existing draft service can later turn into a signed
// draft through its normal authenticated path. Distribution
// approval (Meta actually sending Reels to this endpoint) remains
// an external Meta decision, not something this route grants.

export interface ReelEntryIntent {
  reelId: string;
  companyId: string | null;
  offerId: string | null;
  receivedAt: string;
}

export function validateReelEntry(args: {
  secret: string;
  rawBody: Buffer;
  signatureHeader: string | undefined;
}): ReelEntryIntent {
  if (!args.secret) throw new Error('reel_entry_not_configured');
  if (!verifyHmacSha256Signature({secret: args.secret, rawBody: args.rawBody, signatureHeader: args.signatureHeader})) {
    throw new Error('reel_entry_signature_invalid');
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(args.rawBody.toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('reel_entry_payload_invalid');
  }
  const reelId = boundedString(body.reelId, 'reel_id', 160);
  const companyId = body.companyId === undefined || body.companyId === null
    ? null
    : boundedString(body.companyId, 'reel_company_id', 160);
  const offerId = body.offerId === undefined || body.offerId === null
    ? null
    : boundedString(body.offerId, 'reel_offer_id', 160);
  return {reelId, companyId, offerId, receivedAt: new Date().toISOString()};
}

// --- Live Meta ad ingestion (read-only) -----------------------------------
// Feeds the existing BI verification contract: events are validated
// with parseSuppliedBiEvents (acquisition stamped at creation,
// campaign present = paid), tenant-trimmed to the requesting
// company BEFORE recording, and the watermark advances ONLY on a
// verified success (applyBiIngestionResult). On a client failure the
// watermark is NOT advanced and the prior artifact is retained, so
// output is labeled stale (prior artifact) or unverifiable (none).

export async function ingestMetaAdEvents(args: {
  client: MetaAdsClient;
  companyId: string;
  store: BiEventStore;
  watermarkStore: BiWatermarkStore;
  metric?: 'funnel_counts';
  computedAt?: string;
}): Promise<{
  ok: boolean;
  recorded: number;
  droppedOtherTenant: number;
  status: 'verified' | 'stale' | 'unverifiable';
  error?: string;
}> {
  const computedAt = args.computedAt ?? new Date().toISOString();
  try {
    const raw = await args.client.fetchEvents({companyId: args.companyId});
    const parsed = parseSuppliedBiEvents(raw);
    const tenantEvents = parsed.filter((event) => event.companyId === args.companyId);
    const droppedOtherTenant = parsed.length - tenantEvents.length;
    for (const event of tenantEvents) {
      await args.store.record(event);
    }
    const inputHash = createHash('sha256')
      .update(JSON.stringify(tenantEvents))
      .digest('hex');
    const result = await applyBiIngestionResult({
      store: args.watermarkStore,
      metric: args.metric ?? 'funnel_counts',
      companyId: args.companyId,
      ok: true,
      computedAt,
      inputHash,
      artifactId: `meta-ads:${args.companyId}:${computedAt}`,
    });
    return {
      ok: true,
      recorded: tenantEvents.length,
      droppedOtherTenant,
      status: result.status,
    };
  } catch (error) {
    const result = await applyBiIngestionResult({
      store: args.watermarkStore,
      metric: args.metric ?? 'funnel_counts',
      companyId: args.companyId,
      ok: false,
    });
    return {
      ok: false,
      recorded: 0,
      droppedOtherTenant: 0,
      status: result.status,
      error: error instanceof Error ? error.message : 'meta_ads_ingestion_failed',
    };
  }
}
