/**
 * Server-owned panel session token store — Muse Shopping Index.
 *
 * Muse feature, not a storefront. This store is the missing piece named
 * in docs/live-panel-routes-design.md §5 and docs/product-100-checklist.md:
 * a server-owned mapping from an authenticated panel session to an
 * approval token, per draft, expiring with the draft.
 *
 * WHAT IT IS:
 * - issue() records, server-side only, one approval token for one
 *   (sessionId, draftId), scoped to one authenticated principal
 *   (subject + companyId) and to the server-supplied draft expiry.
 *   The store trusts the server's draft expiry; it never extends it.
 *   The existing panel design uses a 10-minute draft life — that life
 *   is supplied by the caller as draftExpiresAt, never invented here.
 * - verifySession() is the only check a mount needs: it distinguishes
 *   missing / principal-mismatch / draft-mismatch / expired / consumed,
 *   so a mount can fail closed with a distinct error instead of
 *   guessing. A failed verification never returns a token.
 * - resolveApprovalToken() is a convenience for the mount adapter: it
 *   returns the token only for a valid session, otherwise undefined.
 *   It is an internal, server-side resolution — it is never an HTTP
 *   response, never a panel field, and never logged.
 * - consume() marks a session token spent. Spending is checked by the
 *   mount for approve (the only action that spends an approval);
 *   resume is a revalidate-first read, not a spend, so a consumed
 *   session token must still let resume report execution state —
 *   see muse-panel-session-mount.ts. The approval itself is still
 *   consumed exactly once by the existing approval flow.
 * - Two implementations follow the repo's Postgres+memory pattern
 *   (see muse-generic-profile.ts): MemoryPanelSessionTokenStore for
 *   tests, PostgresPanelSessionTokenStore for the server. The table
 *   is muse_panel_session_tokens.
 *
 * WHAT IT IS NOT:
 * - Not a panel-readable store. Nothing in this file serializes a
 *   record, returns a token over HTTP, or accepts a token from a
 *   request body, a caption, model text, or a DOM field. The token
 *   reaches this store only from the authenticated session, supplied
 *   by the server at issue time.
 * - Not an approval, execution, or reminder path. It holds a token;
 *   the existing panel host wiring decides what an approval does.
 * - Not a live route, live Postgres, or live seller. The Postgres
 *   implementation creates its table on first use, but until a real
 *   Postgres pool is supplied by the server operator, no live store
 *   exists. No secret, token value, or approval token appears in
 *   this file, its tests, or its docs — only the names of fields.
 * - Not a second draft store. Draft existence and ownership are
 *   still checked by the mount adapter's draft resolver; this store
 *   only answers "does this session hold a usable token for this
 *   draft, for this principal, right now?"
 *
 * SECURITY NOTE ON THE POSTGRES COLUMN: the approval token is stored
 * in the server's own database because the host needs the actual
 * token to pass to the existing approval flow — a hash could not be
 * returned for that use. That column must therefore be treated as
 * server-only: it is selected only by this module's resolve path,
 * never returned in any HTTP body, never logged, and every row
 * expires with its draft and is removed by purgeExpired(). If the
 * database itself is not server-only, this store must not be used.
 */

import type { Pool } from 'pg';

export interface MusePanelSessionPrincipal {
  subject: string;
  companyId: string;
}

export interface MusePanelSessionIssue {
  sessionId: string;
  subject: string;
  companyId: string;
  draftId: string;
  /** Approval token from the authenticated session only. Never a body field. */
  approvalToken: string;
  /** Server-supplied draft expiry (ISO timestamp). Never extended here. */
  draftExpiresAt: string;
  now?: string;
}

export interface MusePanelSessionLookup {
  sessionId: string;
  principal: MusePanelSessionPrincipal;
  draftId: string;
  now?: string;
}

export type MusePanelSessionVerification =
  | { status: 'valid'; approvalToken: string }
  | {
      status:
        | 'missing'
        | 'principal_mismatch'
        | 'draft_mismatch'
        | 'expired'
        | 'consumed';
    };

export interface MusePanelSessionStore {
  issue(input: MusePanelSessionIssue): Promise<void>;
  verifySession(input: MusePanelSessionLookup): Promise<MusePanelSessionVerification>;
  resolveApprovalToken(input: MusePanelSessionLookup): Promise<string | undefined>;
  consume(input: MusePanelSessionLookup): Promise<boolean>;
  purgeExpired(now: string): Promise<number>;
}

function requireNonEmpty(value: unknown, error: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(error);
  return value.trim();
}

function nowIso(input?: string): string {
  return input ?? new Date().toISOString();
}

interface StoredRecord {
  sessionId: string;
  subject: string;
  companyId: string;
  draftId: string;
  approvalToken: string;
  draftExpiresAt: string;
  consumed: boolean;
}

function verifyRecord(
  record: StoredRecord | undefined,
  input: MusePanelSessionLookup,
  now: string,
): MusePanelSessionVerification {
  if (!record) return { status: 'missing' };
  if (record.subject !== input.principal.subject || record.companyId !== input.principal.companyId) {
    return { status: 'principal_mismatch' };
  }
  if (record.draftId !== input.draftId) return { status: 'draft_mismatch' };
  if (Date.parse(now) >= Date.parse(record.draftExpiresAt) || Number.isNaN(Date.parse(record.draftExpiresAt))) {
    return { status: 'expired' };
  }
  if (record.consumed) return { status: 'consumed' };
  return { status: 'valid', approvalToken: record.approvalToken };
}

export class MemoryPanelSessionTokenStore implements MusePanelSessionStore {
  private readonly values = new Map<string, StoredRecord>();

  // One token per session: the session shows one draft at a time, so
  // a re-issue for the same session supersedes the previous draft's
  // token. The draftId is stored as a field and checked on verify,
  // which is what makes draft_mismatch reachable (a lookup keyed by
  // session+draft could never report a mismatch, only "missing").

  async issue(input: MusePanelSessionIssue): Promise<void> {
    const sessionId = requireNonEmpty(input.sessionId, 'muse_panel_session_id_required');
    const subject = requireNonEmpty(input.subject, 'muse_panel_session_subject_required');
    const companyId = requireNonEmpty(input.companyId, 'muse_panel_session_company_required');
    const draftId = requireNonEmpty(input.draftId, 'muse_panel_route_draft_required');
    const approvalToken = requireNonEmpty(input.approvalToken, 'approval_token_required');
    const draftExpiresAt = requireNonEmpty(input.draftExpiresAt, 'muse_panel_session_expiry_required');
    const now = nowIso(input.now);
    if (Number.isNaN(Date.parse(draftExpiresAt)) || Date.parse(draftExpiresAt) <= Date.parse(now)) {
      throw new Error('muse_panel_session_expiry_invalid');
    }
    this.values.set(sessionId, {
      sessionId, subject, companyId, draftId, approvalToken, draftExpiresAt, consumed: false,
    });
  }

  async verifySession(input: MusePanelSessionLookup): Promise<MusePanelSessionVerification> {
    const record = this.values.get(input.sessionId);
    return verifyRecord(record, input, nowIso(input.now));
  }

  async resolveApprovalToken(input: MusePanelSessionLookup): Promise<string | undefined> {
    const result = await this.verifySession(input);
    return result.status === 'valid' ? result.approvalToken : undefined;
  }

  async consume(input: MusePanelSessionLookup): Promise<boolean> {
    const record = this.values.get(input.sessionId);
    const result = verifyRecord(record, input, nowIso(input.now));
    if (result.status !== 'valid' || !record) return false;
    record.consumed = true;
    return true;
  }

  async purgeExpired(now: string): Promise<number> {
    let removed = 0;
    for (const [sessionId, record] of this.values) {
      if (Date.parse(now) >= Date.parse(record.draftExpiresAt)) {
        this.values.delete(sessionId);
        removed += 1;
      }
    }
    return removed;
  }
}

export class PostgresPanelSessionTokenStore implements MusePanelSessionStore {
  private initialized = false;
  constructor(private readonly pool: Pool) {}

  private async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS muse_panel_session_tokens (
        session_id TEXT NOT NULL PRIMARY KEY,
        draft_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        company_id TEXT NOT NULL,
        approval_token TEXT NOT NULL,
        draft_expires_at TIMESTAMPTZ NOT NULL,
        consumed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    this.initialized = true;
  }

  async issue(input: MusePanelSessionIssue): Promise<void> {
    const sessionId = requireNonEmpty(input.sessionId, 'muse_panel_session_id_required');
    const subject = requireNonEmpty(input.subject, 'muse_panel_session_subject_required');
    const companyId = requireNonEmpty(input.companyId, 'muse_panel_session_company_required');
    const draftId = requireNonEmpty(input.draftId, 'muse_panel_route_draft_required');
    const approvalToken = requireNonEmpty(input.approvalToken, 'approval_token_required');
    const draftExpiresAt = requireNonEmpty(input.draftExpiresAt, 'muse_panel_session_expiry_required');
    const now = nowIso(input.now);
    if (Number.isNaN(Date.parse(draftExpiresAt)) || Date.parse(draftExpiresAt) <= Date.parse(now)) {
      throw new Error('muse_panel_session_expiry_invalid');
    }
    await this.init();
    await this.pool.query(
      `INSERT INTO muse_panel_session_tokens
         (session_id, draft_id, subject, company_id, approval_token, draft_expires_at, consumed)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)
       ON CONFLICT (session_id) DO UPDATE SET
         subject = EXCLUDED.subject,
         company_id = EXCLUDED.company_id,
         approval_token = EXCLUDED.approval_token,
         draft_expires_at = EXCLUDED.draft_expires_at,
         consumed = FALSE`,
      [sessionId, draftId, subject, companyId, approvalToken, draftExpiresAt],
    );
  }

  private async load(sessionId: string): Promise<StoredRecord | undefined> {
    await this.init();
    const result = await this.pool.query(
      `SELECT session_id, draft_id, subject, company_id, approval_token, draft_expires_at, consumed
       FROM muse_panel_session_tokens WHERE session_id = $1`,
      [sessionId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      sessionId: String(row.session_id),
      draftId: String(row.draft_id),
      subject: String(row.subject),
      companyId: String(row.company_id),
      approvalToken: String(row.approval_token),
      draftExpiresAt: new Date(String(row.draft_expires_at)).toISOString(),
      consumed: row.consumed === true,
    };
  }

  async verifySession(input: MusePanelSessionLookup): Promise<MusePanelSessionVerification> {
    const record = await this.load(input.sessionId);
    return verifyRecord(record, input, nowIso(input.now));
  }

  async resolveApprovalToken(input: MusePanelSessionLookup): Promise<string | undefined> {
    const result = await this.verifySession(input);
    return result.status === 'valid' ? result.approvalToken : undefined;
  }

  async consume(input: MusePanelSessionLookup): Promise<boolean> {
    const result = await this.verifySession(input);
    if (result.status !== 'valid') return false;
    await this.init();
    const updated = await this.pool.query(
      `UPDATE muse_panel_session_tokens SET consumed = TRUE
       WHERE session_id = $1 AND consumed = FALSE`,
      [input.sessionId],
    );
    return (updated.rowCount ?? 0) > 0;
  }

  async purgeExpired(now: string): Promise<number> {
    await this.init();
    const result = await this.pool.query(
      `DELETE FROM muse_panel_session_tokens WHERE draft_expires_at <= $1`,
      [now],
    );
    return result.rowCount ?? 0;
  }
}
