/**
 * Meta lead callback webhook — Muse Shopping Index.
 *
 * Muse feature, not a storefront. This is a SEPARATE callback-lead
 * feature, not the Shop-this-reel purchase flow. Nothing in this
 * module grants approval, signs a draft, executes a purchase, or
 * creates an order. It only records that a consumer asked for a
 * callback, so an authorized business can follow up.
 *
 * CODE-READY ONLY, NOT MOUNTED, NOT LIVE:
 * - No HTTP route is registered here, and nothing in this file is
 *   mounted in apps/api/src/index.ts. Wiring it into index.ts is a
 *   separate, separately verifiable step.
 * - No live Meta lead, leadgen subscription, or leads_retrieval
 *   approval is claimed. The Meta app (muse shop index) is
 *   Unpublished and its Catalog API calls were 0 at last check;
 *   no leadgen subscription and no live lead are verified.
 * - No live Graph call is implemented here. fetchLead is an injected
 *   interface only; the future mount must supply it with a
 *   server-owned, tenant-scoped credential from a secret manager.
 *   Never put a Page Access Token, app secret, or any credential
 *   in this file, in a test, in a doc, or in the repo.
 * - No secret, token, phone number, name, or real lead data appears
 *   in this file. Tests use clearly TEST fixtures only.
 *
 * FAIL-CLOSED RULES, IN ORDER, BEFORE ANY FETCH OR STORE:
 * 1. Missing app secret -> muse_lead_webhook_secret_not_configured.
 *    Nothing is fetched, nothing is stored.
 * 2. Bad or missing webhook signature -> muse_lead_webhook_bad_signature.
 *    Nothing is fetched, nothing is stored.
 * 3. Missing leadgen_id or page_id in the event -> invalid event.
 *    Nothing is fetched, nothing is stored.
 * 4. page_id with no server-owned company mapping -> 
 *    muse_lead_webhook_page_not_mapped. Nothing is fetched, nothing
 *    is stored. A company field from the payload is NEVER trusted:
 *    the mapping is supplied by the server only.
 * 5. A lead whose required fields are missing after fetch ->
 *    muse_lead_webhook_incomplete_lead. Nothing is stored.
 * 6. A leadgen_id already stored for the same company is a no-op
 *    duplicate: it is fetched at most once per delivery check below
 *    (the store is consulted before fetch), and a second delivery
 *    never creates a second callback record.
 *
 * Errors are constant strings only. They never contain a phone
 * number, a name, a token, a signature, or a request body, and this
 * module never logs a body or PII.
 *
 * PII MINIMIZATION:
 * The stored record contains ONLY: leadgen_id, companyId, the three
 * Graph field_data values (full_name, phone_number,
 * preferred_callback_date_time), and a received timestamp. Raw
 * page/form/ad identifiers are not stored and are stripped from any
 * consumer-facing output (see toConsumerCallbackSummary). Retention
 * is callback-purpose only; see docs/meta-lead-webhook.md.
 *
 * FUTURE POSTGRES MIGRATION (documented only, NOT wired):
 * Table name: muse_lead_callbacks. Columns, in the same order as the
 * memory record: leadgen_id (text), company_id (text),
 * full_name (text), phone_number (text),
 * preferred_callback_date_time (text), received_at (timestamptz),
 * with a UNIQUE constraint on (leadgen_id, company_id) so a second
 * delivery is a no-op there too. Postgres is NOT wired in this batch;
 * the memory store below is the only store in code.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Graph API version, as a constant only. No request is made here. */
export const META_GRAPH_API_VERSION = 'v26.0';

/** Path a future, server-owned fetch would use. No token, no fetch. */
export function buildLeadGraphPath(leadgenId: string): string {
  return `/${META_GRAPH_API_VERSION}/${leadgenId}`;
}

export type LeadWebhookSubscriptionQuery = Record<string, string | undefined>;

export type LeadWebhookSubscriptionResult =
  | { status: 200; challenge: string }
  | { status: 403; error: 'muse_lead_webhook_forbidden' };

/**
 * Meta GET handshake for webhook subscription verification.
 * The challenge is returned ONLY when hub.mode is 'subscribe' AND
 * hub.verify_token exactly matches the server-owned verify token.
 * On any mismatch, nothing is echoed: 403, no challenge.
 */
export function verifyWebhookSubscription(
  query: LeadWebhookSubscriptionQuery,
  verifyToken: string | undefined,
): LeadWebhookSubscriptionResult {
  if (
    query['hub.mode'] === 'subscribe' &&
    typeof verifyToken === 'string' &&
    verifyToken.length > 0 &&
    query['hub.verify_token'] === verifyToken &&
    typeof query['hub.challenge'] === 'string' &&
    query['hub.challenge'].length > 0
  ) {
    return { status: 200, challenge: query['hub.challenge'] };
  }
  return { status: 403, error: 'muse_lead_webhook_forbidden' };
}

export type LeadWebhookSignatureResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'muse_lead_webhook_secret_not_configured'
        | 'muse_lead_webhook_bad_signature';
    };

/**
 * Verify a Meta webhook signature: HMAC-SHA256 over the raw body,
 * expected header format 'sha256=<hex>'. Timing-safe compare.
 * Missing secret fails closed; a missing, malformed, or mismatched
 * signature fails closed. The body is never logged.
 */
export function verifyLeadWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  appSecret: string | undefined,
): LeadWebhookSignatureResult {
  if (typeof appSecret !== 'string' || appSecret.length === 0) {
    return { ok: false, error: 'muse_lead_webhook_secret_not_configured' };
  }
  if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) {
    return { ok: false, error: 'muse_lead_webhook_bad_signature' };
  }
  const suppliedHex = signatureHeader.slice('sha256='.length);
  if (!/^[0-9a-fA-F]+$/.test(suppliedHex)) {
    return { ok: false, error: 'muse_lead_webhook_bad_signature' };
  }
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedHex, 'hex');
  } catch {
    return { ok: false, error: 'muse_lead_webhook_bad_signature' };
  }
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return { ok: false, error: 'muse_lead_webhook_bad_signature' };
  }
  return { ok: true };
}

export interface ParsedLeadEvent {
  leadgenId: string;
  pageId: string;
  formId?: string;
  adId?: string;
}

export type ParseLeadEventResult =
  | { ok: true; event: ParsedLeadEvent }
  | { ok: false; error: 'muse_lead_webhook_invalid_event' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Extract a leadgen event from a Meta webhook body.
 * Expected shape (Page object, leadgen field):
 *   { object: 'page', entry: [{ id: <page_id>,
 *     changes: [{ field: 'leadgen',
 *       value: { leadgen_id, form_id?, ad_id? } }] }] }
 * Missing leadgen_id or page_id rejects the event; nothing is
 * fetched or stored for a rejected event. form_id / ad_id, when
 * present, are carried on the parsed event for server-side routing
 * only and are never stored in a callback record.
 */
export function parseLeadWebhookEvent(body: unknown): ParseLeadEventResult {
  if (!isRecord(body)) {
    return { ok: false, error: 'muse_lead_webhook_invalid_event' };
  }
  const entries = body['entry'];
  if (!Array.isArray(entries)) {
    return { ok: false, error: 'muse_lead_webhook_invalid_event' };
  }
  for (const entry of entries) {
    if (!isRecord(entry) || !nonEmptyString(entry['id'])) {
      continue;
    }
    const changes = entry['changes'];
    if (!Array.isArray(changes)) {
      continue;
    }
    for (const change of changes) {
      if (!isRecord(change) || change['field'] !== 'leadgen') {
        continue;
      }
      const value = change['value'];
      if (!isRecord(value) || !nonEmptyString(value['leadgen_id'])) {
        continue;
      }
      const event: ParsedLeadEvent = {
        leadgenId: value['leadgen_id'],
        pageId: entry['id'],
      };
      if (nonEmptyString(value['form_id'])) {
        event.formId = value['form_id'];
      }
      if (nonEmptyString(value['ad_id'])) {
        event.adId = value['ad_id'];
      }
      return { ok: true, event };
    }
  }
  return { ok: false, error: 'muse_lead_webhook_invalid_event' };
}

/** Graph GET /{lead_id} response shape, as supplied by fetchLead. */
export interface LeadApiFieldData {
  name: string;
  values: string[];
}

export interface LeadApiRecord {
  id?: string;
  field_data?: LeadApiFieldData[];
}

/** Injected fetch only. No live Graph call, no token, in this module. */
export type FetchLead = (leadgenId: string) => Promise<LeadApiRecord>;

/** Stored callback record: ONLY the fields listed in the header. */
export interface LeadCallbackRecord {
  leadgenId: string;
  companyId: string;
  fullName: string;
  phoneNumber: string;
  preferredCallbackDateTime: string;
  receivedAt: string;
}

export interface LeadCallbackStore {
  get(leadgenId: string, companyId: string): LeadCallbackRecord | undefined;
  put(record: LeadCallbackRecord): void;
}

/** Memory store keyed by leadgen_id + companyId. NOT Postgres. */
export function createLeadCallbackMemoryStore(): LeadCallbackStore {
  const records = new Map<string, LeadCallbackRecord>();
  return {
    get(leadgenId: string, companyId: string): LeadCallbackRecord | undefined {
      return records.get(`${companyId}:${leadgenId}`);
    },
    put(record: LeadCallbackRecord): void {
      records.set(`${record.companyId}:${record.leadgenId}`, record);
    },
  };
}

/**
 * Consumer-facing summary: raw IDs and PII are stripped. A consumer
 * (or any non-owner reader) sees only that a callback was requested
 * for their company and when — never a leadgen_id, page_id, form_id,
 * ad_id, name, or phone number.
 */
export function toConsumerCallbackSummary(record: LeadCallbackRecord): {
  companyId: string;
  status: 'callback_requested';
  receivedAt: string;
} {
  return {
    companyId: record.companyId,
    status: 'callback_requested',
    receivedAt: record.receivedAt,
  };
}

export type HandleLeadWebhookArgs = {
  /** Parsed event from parseLeadWebhookEvent. Never trust its company. */
  event: ParsedLeadEvent;
  /** Raw request body, for signature verification. Never logged. */
  rawBody: string | Buffer;
  /** Value of the X-Hub-Signature-256 header, if any. */
  signature: string | undefined;
  /** Server-owned app secret, from a secret manager. Never in code. */
  secret: string | undefined;
  /** Server-owned page_id -> companyId mapping. Payload never sets this. */
  pageToCompany: (pageId: string) => string | undefined;
  /** Injected Graph fetch. Called only after all fail-closed checks pass. */
  fetchLead: FetchLead;
  store: LeadCallbackStore;
  now?: string;
};

export type HandleLeadWebhookResult =
  | { status: 'stored'; record: LeadCallbackRecord }
  | { status: 'duplicate'; record: LeadCallbackRecord }
  | {
      status: 'rejected';
      error:
        | 'muse_lead_webhook_secret_not_configured'
        | 'muse_lead_webhook_bad_signature'
        | 'muse_lead_webhook_page_not_mapped'
        | 'muse_lead_webhook_incomplete_lead';
    };

function fieldValue(record: LeadApiRecord, name: string): string | undefined {
  if (!Array.isArray(record.field_data)) {
    return undefined;
  }
  for (const field of record.field_data) {
    if (field.name === name && Array.isArray(field.values) && field.values.length > 0) {
      const value = field.values[0];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * Handle one verified leadgen webhook delivery.
 * Order is deliberate: signature, then tenant mapping, then
 * duplicate check, then fetch, then field validation, then store.
 * A refused delivery never reaches fetch or store, and no error
 * ever contains PII, a token, or a signature.
 */
export async function handleLeadWebhook(
  args: HandleLeadWebhookArgs,
): Promise<HandleLeadWebhookResult> {
  const signature = verifyLeadWebhookSignature(args.rawBody, args.signature, args.secret);
  if (!signature.ok) {
    return { status: 'rejected', error: signature.error };
  }
  const companyId = args.pageToCompany(args.event.pageId);
  if (typeof companyId !== 'string' || companyId.length === 0) {
    return { status: 'rejected', error: 'muse_lead_webhook_page_not_mapped' };
  }
  const existing = args.store.get(args.event.leadgenId, companyId);
  if (existing !== undefined) {
    return { status: 'duplicate', record: existing };
  }
  const lead = await args.fetchLead(args.event.leadgenId);
  const fullName = fieldValue(lead, 'full_name');
  const phoneNumber = fieldValue(lead, 'phone_number');
  const preferredCallbackDateTime = fieldValue(lead, 'preferred_callback_date_time');
  if (
    fullName === undefined ||
    phoneNumber === undefined ||
    preferredCallbackDateTime === undefined
  ) {
    return { status: 'rejected', error: 'muse_lead_webhook_incomplete_lead' };
  }
  const record: LeadCallbackRecord = {
    leadgenId: args.event.leadgenId,
    companyId,
    fullName,
    phoneNumber,
    preferredCallbackDateTime,
    receivedAt: args.now ?? new Date().toISOString(),
  };
  args.store.put(record);
  return { status: 'stored', record };
}
