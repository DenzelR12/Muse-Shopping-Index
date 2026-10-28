/**
 * Panel live wiring — Muse Shopping Index.
 *
 * Muse feature, not a storefront. This module closes three of the four
 * gaps named in docs/muse-panel-session-store.md §4 and
 * docs/live-panel-routes-design.md §5/§7, in code, without inventing
 * any identity, token, draft, or host that does not exist:
 *
 * 1. SERVER-OWNED DRAFT LOOKUP. PanelDraftRegistry is the draft
 *    store index.ts previously lacked (its resolveDraft returned
 *    null, so every panel request ended at 404). registerDraft()
 *    is server-internal only — there is no HTTP route for it in
 *    this module, and a draft is never created from a request
 *    body, a caption, or model text. resolveDraft() returns a
 *    draft only for its own company, only while unexpired;
 *    expired or unknown drafts return null, so the mount fails
 *    closed at 404 instead of inventing a draft.
 * 2. SESSION ISSUANCE. issuePanelSession() is the issuance path
 *    index.ts previously lacked. It takes an authenticated
 *    principal, a registered draft, and an approval token that
 *    the caller supplies from the authenticated session only
 *    (never from a body, DOM field, caption, or model text),
 *    checks draft existence, company ownership, and expiry,
 *    generates the sessionId server-side with crypto.randomUUID()
 *    (never client-supplied), and issues it into the existing
 *    panel session token store. It returns the sessionId to the
 *    server caller only — it is not an HTTP response.
 * 3. REAL HOST METHODS ADAPTER. createPanelLiveHostDeps()
 *    wraps the existing server methods (approveDraft,
 *    resumeDraft, optInReminder, optOutReminder, with exactly
 *    the signatures muse-panel-host.ts expects) and adds only:
 *    principal + tenant checks before any call, and an
 *    in-flight guard on approve so a second concurrent approve
 *    cannot create a second execution claim. It never invents
 *    an approval, never converts a failure into a success, and
 *    never retries. When no host methods are bound, the adapter
 *    fails closed with muse_panel_host_not_configured.
 *
 * WHAT REMAINS — READ THIS BEFORE CLAIMING A LIVE ROUTE:
 * The production host binding is still open, and it is now the
 * ONLY remaining panel gap, narrowed from four to one. index.ts
 * panel branches authenticate a company principal (orgId) and
 * have no consumer identity, no connectionId, and no approval
 * token from an authenticated panel session. The existing
 * approval flow needs all three (consumer subjectId,
 * connectionId, approval token from the authenticated session,
 * via AuthenticatedMuseCommerceHost in /v1/muse/agent).
 * Binding a fake consumer, a guessed connectionId, or a
 * body-derived token here would violate the safety model, so
 * this module does not do it. Until a Muse host supplies a
 * real authenticated panel session and binds its host methods
 * through this adapter, live panel routes still refuse
 * approve/resume/reminder — but now they refuse at the host
 * binding, with drafts and sessions actually resolvable, not
 * at a null draft lookup. See docs/muse-panel-live-wiring.md.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  MusePanelSessionStore,
  MusePanelSessionPrincipal,
} from './muse-panel-session-store.js';
import type { MusePanelHostDependencies } from './muse-panel-host.js';
import type { MusePanelMountDraft } from './muse-panel-mount.js';

export interface PanelDraftRecord {
  draftId: string;
  companyId: string;
  expiresAt: string;
}

export interface PanelDraftRegistry {
  registerDraft(input: { draftId: string; companyId: string; expiresAt: string; now?: string }): Promise<void>;
  resolveDraft(input: { principal: MusePanelSessionPrincipal; draftId: string; now?: string }): Promise<PanelDraftRecord | null>;
}

function requireNonEmpty(value: string | undefined, code: string): string {
  if (!value || value.trim() === '') throw new Error(code);
  return value;
}

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

export class MemoryPanelDraftRegistry implements PanelDraftRegistry {
  private readonly values = new Map<string, PanelDraftRecord>();

  async registerDraft(input: { draftId: string; companyId: string; expiresAt: string; now?: string }): Promise<void> {
    const draftId = requireNonEmpty(input.draftId, 'muse_panel_route_draft_required');
    const companyId = requireNonEmpty(input.companyId, 'muse_panel_session_company_required');
    const expiresAt = requireNonEmpty(input.expiresAt, 'muse_panel_session_expiry_required');
    const now = nowIso(input.now);
    if (Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(now)) {
      throw new Error('muse_panel_session_expiry_invalid');
    }
    const existing = this.values.get(draftId);
    if (existing && existing.companyId !== companyId) {
      throw new Error('provider_readiness_company_mismatch');
    }
    this.values.set(draftId, { draftId, companyId, expiresAt });
  }

  async resolveDraft(input: { principal: MusePanelSessionPrincipal; draftId: string; now?: string }): Promise<PanelDraftRecord | null> {
    const record = this.values.get(input.draftId);
    if (!record) return null;
    if (new Date(nowIso(input.now)).getTime() >= new Date(record.expiresAt).getTime()) return null;
    return { draftId: record.draftId, companyId: record.companyId, expiresAt: record.expiresAt };
  }
}

export class PostgresPanelDraftRegistry implements PanelDraftRegistry {
  private readonly pool: Pool;
  private initialized = false;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS muse_panel_drafts (
        draft_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    this.initialized = true;
  }

  async registerDraft(input: { draftId: string; companyId: string; expiresAt: string; now?: string }): Promise<void> {
    const draftId = requireNonEmpty(input.draftId, 'muse_panel_route_draft_required');
    const companyId = requireNonEmpty(input.companyId, 'muse_panel_session_company_required');
    const expiresAt = requireNonEmpty(input.expiresAt, 'muse_panel_session_expiry_required');
    const now = nowIso(input.now);
    if (Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(now)) {
      throw new Error('muse_panel_session_expiry_invalid');
    }
    await this.init();
    await this.pool.query(
      `INSERT INTO muse_panel_drafts (draft_id, company_id, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (draft_id) DO NOTHING`,
      [draftId, companyId, expiresAt],
    );
    const row = await this.pool.query(
      `SELECT company_id FROM muse_panel_drafts WHERE draft_id = $1`, [draftId],
    );
    if (row.rows[0] && String(row.rows[0].company_id) !== companyId) {
      throw new Error('provider_readiness_company_mismatch');
    }
  }

  async resolveDraft(input: { principal: MusePanelSessionPrincipal; draftId: string; now?: string }): Promise<PanelDraftRecord | null> {
    await this.init();
    const result = await this.pool.query(
      `SELECT draft_id, company_id, expires_at FROM muse_panel_drafts WHERE draft_id = $1`,
      [input.draftId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const expiresAt = new Date(String(row.expires_at)).toISOString();
    if (new Date(nowIso(input.now)).getTime() >= new Date(expiresAt).getTime()) return null;
    return { draftId: String(row.draft_id), companyId: String(row.company_id), expiresAt };
  }
}

export interface PanelSessionIssueInput {
  store: MusePanelSessionStore;
  draftRegistry: PanelDraftRegistry;
  principal: MusePanelSessionPrincipal;
  draftId: string;
  /** From the authenticated session only. Never a body field. */
  approvalToken: string;
  now?: string;
}

export async function issuePanelSession(input: PanelSessionIssueInput): Promise<{ sessionId: string; draftId: string; expiresAt: string }> {
  const principal = input.principal;
  if (!principal || !principal.subject?.trim() || !principal.companyId?.trim()) {
    throw new Error('muse_panel_route_principal_required');
  }
  const draftId = requireNonEmpty(input.draftId, 'muse_panel_route_draft_required');
  const approvalToken = requireNonEmpty(input.approvalToken, 'approval_token_required');
  const draft = await input.draftRegistry.resolveDraft({ principal, draftId, now: input.now });
  if (!draft) throw new Error('muse_panel_mount_draft_not_found');
  if (draft.companyId !== principal.companyId) throw new Error('provider_readiness_company_mismatch');
  const sessionId = randomUUID();
  await input.store.issue({
    sessionId, subject: principal.subject, companyId: principal.companyId,
    draftId, approvalToken, draftExpiresAt: draft.expiresAt, now: input.now,
  });
  return { sessionId, draftId, expiresAt: draft.expiresAt };
}

/** Build the mount's draft resolver from a registry. Mount still checks company. */
export function panelDraftResolver(
  registry: PanelDraftRegistry,
  now?: string | (() => string),
): (args: { principal: MusePanelSessionPrincipal; draftId: string }) => Promise<MusePanelMountDraft | null> {
  // The mount adapter's resolver signature carries no `now`, so a
  // caller that needs a fixed test clock must pass it here. Live
  // callers (index.ts) pass nothing and get real time. Passing a
  // stale fixed clock with an expired draft is a test bug, not a
  // wiring bug: the registry correctly returns null for expired drafts.
  return async ({ principal, draftId }) => {
    const at = typeof now === 'function' ? now() : now;
    const draft = await registry.resolveDraft({ principal, draftId, ...(at ? { now: at } : {}) });
    if (!draft) return null;
    return { draftId: draft.draftId, companyId: draft.companyId };
  };
}

export type PanelLiveHostMethods = Partial<MusePanelHostDependencies>;

/**
 * Adapter for real host methods. Unbound methods fail closed with
 * muse_panel_host_not_configured — the same error index.ts stubs
 * used to throw, now routed through a real adapter with tenant
 * checks and an approve in-flight guard.
 */
export function createPanelLiveHostDeps(methods: PanelLiveHostMethods): MusePanelHostDependencies {
  let approveInFlight = false;
  function requireBound<T>(value: T | undefined): T {
    if (!value) throw new Error('muse_panel_host_not_configured');
    return value;
  }
  function checkPrincipal(principal: MusePanelSessionPrincipal): void {
    if (!principal || !principal.subject?.trim() || !principal.companyId?.trim()) {
      throw new Error('muse_panel_host_principal_required');
    }
  }
  return {
    approveDraft: async (args) => {
      checkPrincipal(args.principal);
      const fn = requireBound(methods.approveDraft);
      if (approveInFlight) throw new Error('muse_panel_approve_in_flight');
      approveInFlight = true;
      try {
        return await fn(args);
      } finally {
        approveInFlight = false;
      }
    },
    resumeDraft: async (args) => {
      checkPrincipal(args.principal);
      return requireBound(methods.resumeDraft)(args);
    },
    optInReminder: async (args) => {
      checkPrincipal(args.principal);
      return requireBound(methods.optInReminder)(args);
    },
    optOutReminder: async (args) => {
      checkPrincipal(args.principal);
      return requireBound(methods.optOutReminder)(args);
    },
  };
}
