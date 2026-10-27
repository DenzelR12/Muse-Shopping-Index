import type {Pool} from 'pg';

/**
 * Opt-in, single, generic reminder for an unapproved exact review —
 * Muse Shopping Index.
 *
 * This implements the reminder half of docs/accessibility-abandoned-recovery.md
 * §3. It is a gated server component, not a live channel and not a
 * consumer-facing button: the production host wiring for an opt-in
 * entry from the review UI does not exist yet (see the doc), and no
 * real consumer has received a reminder from this module.
 *
 * RULES, ENFORCED IN CODE (not just in docs):
 *
 * 1. OPT-IN IS EXPLICIT ONLY. Viewing a review, starting an intent, or
 *    having a draft is NEVER opt-in. Approving a purchase is not
 *    consent to reminders, and asking for a reminder is not approval
 *    of a purchase. The default is no reminder. optInToReminder is
 *    the only way a PENDING record is created.
 *
 * 2. IDENTITY COMES FROM THE AUTHENTICATED PRINCIPAL ONLY.
 *    principalSubject and principalCompanyId are the server-resolved
 *    authenticated principal. They are never read from a request
 *    body, a caption, or model text — callers must pass the
 *    principal's values, exactly as readMetaCatalog takes a
 *    principalCompanyId. companyId must equal principalCompanyId
 *    (else provider_readiness_company_mismatch), and the draft
 *    state supplied to sendReminder must belong to that same
 *    consumer + company, or the send is refused before any channel
 *    call.
 *
 * 3. ELIGIBILITY IS CHECKED BEFORE ANY SEND, IN ORDER: tenant
 *    match, an opt-in record exists, the record is PENDING, the
 *    draft is owned by this consumer + company, the draft is not
 *    expired, the draft is neither approved nor executed. A
 *    reminder is for an UNAPPROVED review only: it never reminds
 *    anyone to re-approve an already-approved purchase, and never
 *    reminds after execution. Any failed check throws and nothing
 *    is sent; no approval is consumed by any path here.
 *
 * 4. CONTENT IS GENERIC BY CONSTRUCTION. The payload is a single
 *    fixed constant, MUSE_REMINDER_PAYLOAD. It contains no price,
 *    no seller or product claim, no draft terms, no approval token,
 *    no raw provider ID, and no buy pitch — there is no field in
 *    the payload type where such a value could even be put. A
 *    reminder that contained a price would be an out-of-date
 *    review, and a message is not an exact review. The reminder
 *    authorises nothing: opening Muse must revalidate the draft
 *    first (expired/changed -> a new draft, a new review with a
 *    diff, and a fresh approval; an old unapproved review is
 *    never carried over). That revalidation lives in the draft
 *    service, not here.
 *
 * 5. SENDING IS FAIL-CLOSED AND CHANNEL-GATED, following the same
 *    pattern as the Shop Pay / live-ads / generic-adapter gates:
 *    the channel is an interface supplied by the caller (registered
 *    at server startup by the operator, never over HTTP, never
 *    from a request body). No channel -> muse_reminder_channel_
 *    not_registered, nothing sent. No email/SMS API is called
 *    directly by this module, no channel credentials are used
 *    here, and a channel send that throws leaves the record
 *    PENDING — a failed send is never recorded as SENT.
 *
 * 6. ONE REMINDER ONLY, EVER, PER DRAFT. After a successful send
 *    the record becomes SENT and any second send for the same
 *    draft is refused (muse_reminder_not_pending). Opt-out and
 *    dismiss are single authenticated actions that move a record
 *    to OPTED_OUT / DISMISSED. The two sentences in the design
 *    doc — "opt-out permanently prevents that draft's reminder"
 *    and "a later re-opt-in is allowed" — are reconciled here
 *    as: opt-out permanently kills the EXISTING pending
 *    reminder (it never auto-revives), and a fresh explicit
 *    re-opt-in may create a new PENDING record ONLY if no
 *    reminder has ever been sent for that draft (sentCount is
 *    still 0) and, when draft state is supplied, the draft is
 *    still unapproved and unexpired. After a reminder has been
 *    sent, no re-opt-in can create another one, so reminder
 *    loops are impossible by construction.
 *
 * 7. PRIVACY AND RETENTION. Records are keyed by consumer +
 *    company + draft and are never shared across companies or
 *    consumers, never fed into ads or retargeting, and never
 *    read back to anyone except the owning consumer's own
 *    authenticated flow. A record is retained only for its
 *    draft's expiry window: once the draft has expired, the
 *    record is dead (it can never send) and is eligible for
 *    deletion. No retention job is implemented in this change;
 *    the deletion itself is a separate operational step.
 *
 * 8. NO PUBLIC ROUTE IN THIS CHANGE. Like readMetaCatalog, this
 *    module is an internal helper: optInToReminder,
 *    optOutOfReminder, and sendMuseReminder. There is deliberately
 *    no new public purchase route and no route that accepts a
 *    subject or company from a body — a future route must pass
 *    the authenticated principal, or it must not exist.
 */

export type MuseReminderStatus = 'PENDING' | 'SENT' | 'OPTED_OUT' | 'DISMISSED';

/** Fixed, reviewed reminder text. The only text a reminder may carry. */
export const MUSE_REMINDER_TEXT =
  'Your review is waiting in Muse. Open Muse to return to your review.';

/** The entire reminder payload: fixed text only, no price, no terms, no token, no ID. */
export const MUSE_REMINDER_PAYLOAD = Object.freeze({
  kind: 'muse_reminder',
  text: MUSE_REMINDER_TEXT,
}) as {kind: 'muse_reminder'; text: string};

export type MuseReminderPayload = typeof MUSE_REMINDER_PAYLOAD;

/** Authorized channel interface. Supplied at startup, never over HTTP. */
export interface MuseReminderChannel {
  send(payload: MuseReminderPayload): Promise<void>;
}

export interface MuseReminderRecord {
  consumerSubject: string;
  companyId: string;
  draftId: string;
  status: MuseReminderStatus;
  /** Number of reminders ever sent for this draft. 0 or 1, by construction. */
  sentCount: number;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

/** Draft state as supplied by the server-owned draft service, never by a body. */
export interface MuseReminderDraftState {
  draftId: string;
  consumerSubject: string;
  companyId: string;
  /** ISO expiry of the draft. Unparseable or past expiry = expired. */
  expiresAt: string;
  approved: boolean;
  executed: boolean;
}

export interface MuseReminderStore {
  get(args: {consumerSubject: string; companyId: string; draftId: string}): Promise<MuseReminderRecord | null>;
  save(record: MuseReminderRecord): Promise<MuseReminderRecord>;
}

function keyOf(args: {consumerSubject: string; companyId: string; draftId: string}): string {
  return `${args.consumerSubject}\0${args.companyId}\0${args.draftId}`;
}

function requireNonEmpty(value: unknown, error: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(error);
  return value;
}

function isExpired(expiresAt: string, now: string): boolean {
  const expiry = Date.parse(expiresAt);
  const at = Date.parse(now);
  return !Number.isFinite(expiry) || !Number.isFinite(at) || expiry <= at;
}

/** In-memory store for tests and for hosts without Postgres. Not a durable record. */
export class MemoryMuseReminderStore implements MuseReminderStore {
  private readonly rows = new Map<string, MuseReminderRecord>();
  async get(args: {consumerSubject: string; companyId: string; draftId: string}): Promise<MuseReminderRecord | null> {
    const found = this.rows.get(keyOf(args));
    return found ? {...found} : null;
  }
  async save(record: MuseReminderRecord): Promise<MuseReminderRecord> {
    const copy = {...record};
    this.rows.set(keyOf(copy), copy);
    return {...copy};
  }
}

function rowToRecord(row: any): MuseReminderRecord {
  return {
    consumerSubject: String(row.consumer_subject),
    companyId: String(row.company_id),
    draftId: String(row.draft_id),
    status: row.status as MuseReminderStatus,
    sentCount: Number(row.sent_count) || 0,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    sentAt: row.sent_at === null || row.sent_at === undefined ? null : new Date(row.sent_at).toISOString(),
  };
}

/**
 * Postgres store, following the company_seller_manifests pattern:
 * the store creates its own table on first use (CREATE TABLE IF NOT
 * EXISTS), so no separate migration run is required. One row per
 * consumer + company + draft. Status is only ever written by the
 * functions in this module, never from a request payload.
 */
export class PostgresMuseReminderStore implements MuseReminderStore {
  private initialized = false;
  constructor(private readonly pool: Pool) {}
  private async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS muse_reminders (
        consumer_subject TEXT NOT NULL,
        company_id TEXT NOT NULL,
        draft_id TEXT NOT NULL,
        status TEXT NOT NULL,
        sent_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        sent_at TIMESTAMPTZ,
        PRIMARY KEY (consumer_subject, company_id, draft_id)
      )
    `);
    this.initialized = true;
  }
  async get(args: {consumerSubject: string; companyId: string; draftId: string}): Promise<MuseReminderRecord | null> {
    await this.init();
    const result = await this.pool.query(
      'SELECT * FROM muse_reminders WHERE consumer_subject = $1 AND company_id = $2 AND draft_id = $3',
      [args.consumerSubject, args.companyId, args.draftId],
    );
    return result.rows.length ? rowToRecord(result.rows[0]) : null;
  }
  async save(record: MuseReminderRecord): Promise<MuseReminderRecord> {
    await this.init();
    const result = await this.pool.query(
      `INSERT INTO muse_reminders
         (consumer_subject, company_id, draft_id, status, sent_count, created_at, updated_at, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (consumer_subject, company_id, draft_id) DO UPDATE SET
         status = EXCLUDED.status, sent_count = EXCLUDED.sent_count,
         updated_at = EXCLUDED.updated_at, sent_at = EXCLUDED.sent_at
       RETURNING *`,
      [record.consumerSubject, record.companyId, record.draftId, record.status, record.sentCount, record.createdAt, record.updatedAt, record.sentAt],
    );
    return rowToRecord(result.rows[0]);
  }
}

/**
 * Explicit opt-in, at the review stage only. Viewing a review,
 * starting an intent, or having a draft never calls this. The
 * principal values must come from authenticated server state.
 * Idempotent while PENDING; refuses after a reminder has been
 * sent; a fresh re-opt-in after OPTED_OUT/DISMISSED is allowed
 * only while no reminder has ever been sent (and, when draft
 * state is supplied, only while the draft is still unapproved
 * and unexpired) — it then creates at most one more reminder,
 * never a loop.
 */
export async function optInToReminder(args: {
  store: MuseReminderStore;
  principalSubject: string;
  principalCompanyId: string;
  companyId: string;
  draftId: string;
  draftState?: MuseReminderDraftState;
  now: string;
}): Promise<MuseReminderRecord> {
  const principalSubject = requireNonEmpty(args.principalSubject, 'muse_reminder_subject_required');
  const principalCompanyId = requireNonEmpty(args.principalCompanyId, 'muse_reminder_company_required');
  const companyId = requireNonEmpty(args.companyId, 'muse_reminder_company_required');
  const draftId = requireNonEmpty(args.draftId, 'muse_reminder_draft_required');
  const now = requireNonEmpty(args.now, 'muse_reminder_now_required');
  if (companyId !== principalCompanyId) throw new Error('provider_readiness_company_mismatch');
  const existing = await args.store.get({consumerSubject: principalSubject, companyId, draftId});
  if (existing && existing.status === 'PENDING') return existing;
  if (existing && existing.status === 'SENT') throw new Error('muse_reminder_already_sent');
  if (existing && existing.sentCount > 0) throw new Error('muse_reminder_already_sent');
  if (existing && (existing.status === 'OPTED_OUT' || existing.status === 'DISMISSED')) {
    const draft = args.draftState;
    if (draft) {
      if (draft.draftId !== draftId || draft.consumerSubject !== principalSubject || draft.companyId !== companyId) {
        throw new Error('provider_readiness_company_mismatch');
      }
      if (draft.approved || draft.executed) throw new Error('muse_reminder_draft_already_approved');
      if (isExpired(draft.expiresAt, now)) throw new Error('muse_reminder_draft_expired');
    }
    return args.store.save({...existing, status: 'PENDING', updatedAt: new Date(now).toISOString()});
  }
  return args.store.save({
    consumerSubject: principalSubject,
    companyId,
    draftId,
    status: 'PENDING',
    sentCount: 0,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    sentAt: null,
  });
}

/**
 * Single authenticated opt-out or dismiss. Moves a PENDING record
 * to OPTED_OUT / DISMISSED and permanently kills that pending
 * reminder (it never auto-revives; only a fresh explicit
 * re-opt-in, per optInToReminder, can create a new one, and
 * only before any reminder has been sent). No record -> null:
 * there is nothing to opt out of, and no record is invented.
 */
export async function optOutOfReminder(args: {
  store: MuseReminderStore;
  principalSubject: string;
  principalCompanyId: string;
  companyId: string;
  draftId: string;
  action: 'opt_out' | 'dismiss';
  now: string;
}): Promise<MuseReminderRecord | null> {
  const principalSubject = requireNonEmpty(args.principalSubject, 'muse_reminder_subject_required');
  const principalCompanyId = requireNonEmpty(args.principalCompanyId, 'muse_reminder_company_required');
  const companyId = requireNonEmpty(args.companyId, 'muse_reminder_company_required');
  const draftId = requireNonEmpty(args.draftId, 'muse_reminder_draft_required');
  if (companyId !== principalCompanyId) throw new Error('provider_readiness_company_mismatch');
  const existing = await args.store.get({consumerSubject: principalSubject, companyId, draftId});
  if (!existing) return null;
  if (existing.status === 'SENT') return existing;
  return args.store.save({
    ...existing,
    status: args.action === 'opt_out' ? 'OPTED_OUT' : 'DISMISSED',
    updatedAt: new Date(args.now).toISOString(),
  });
}

/**
 * Send the single generic reminder, if and only if every
 * eligibility condition holds. Checks run in order and the
 * channel is called last, so no failed check can ever send.
 * A channel failure leaves the record PENDING and propagates;
 * it is never recorded as SENT. On success the record becomes
 * SENT and no second send for this draft is possible.
 */
export async function sendMuseReminder(args: {
  store: MuseReminderStore;
  channel: MuseReminderChannel | null;
  principalSubject: string;
  principalCompanyId: string;
  draft: MuseReminderDraftState;
  now: string;
}): Promise<MuseReminderRecord> {
  const principalSubject = requireNonEmpty(args.principalSubject, 'muse_reminder_subject_required');
  const principalCompanyId = requireNonEmpty(args.principalCompanyId, 'muse_reminder_company_required');
  const draft = args.draft;
  if (!draft || draft.companyId !== principalCompanyId) throw new Error('provider_readiness_company_mismatch');
  if (draft.consumerSubject !== principalSubject) throw new Error('provider_readiness_company_mismatch');
  const record = await args.store.get({consumerSubject: principalSubject, companyId: principalCompanyId, draftId: draft.draftId});
  if (!record) throw new Error('muse_reminder_not_opted_in');
  if (record.status !== 'PENDING') throw new Error('muse_reminder_not_pending');
  if (draft.approved || draft.executed) throw new Error('muse_reminder_draft_already_approved');
  if (isExpired(draft.expiresAt, args.now)) throw new Error('muse_reminder_draft_expired');
  if (!args.channel) throw new Error('muse_reminder_channel_not_registered');
  await args.channel.send(MUSE_REMINDER_PAYLOAD);
  return args.store.save({
    ...record,
    status: 'SENT',
    sentCount: 1,
    sentAt: new Date(args.now).toISOString(),
    updatedAt: new Date(args.now).toISOString(),
  });
}
