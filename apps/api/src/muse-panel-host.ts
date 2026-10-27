/**
 * Muse feature panel host wiring — Muse Shopping Index.
 *
 * This closes the gap left by HEAD 11b51a3, where the Muse
 * feature panel (apps/demo/src/muse-feature-panel.ts) rendered
 * server state and dispatched callbacks, but no host-side code
 * mapped those callbacks to server methods. This module is
 * that mapping — and nothing more.
 *
 * WHAT THIS IS: a host-side adapter that the server builds
 * from authenticated server state only. The host constructs
 * it with:
 * - the authenticated principal (subject + companyId), resolved
 *   by the server's own authentication, never by the panel,
 *   never from a request body, a caption, or model text;
 * - the draft the panel is showing (draftId), from the
 *   server-owned signed draft, never from panel input;
 * - the approval token, when one exists, from the
 *   authenticated session — never from the panel, never
 *   from a DOM field.
 * It returns panel-shaped handlers {onApprove, onResume,
 * onReminderOptIn, onReminderOptOut} that the host passes to
 * mountMuseFeaturePanel. The handler type here is structural:
 * it matches the panel's MuseFeaturePanelHandlers shape
 * (callbacks taking no arguments), so the panel and the host
 * never exchange identity, tokens, or facts through the DOM.
 *
 * WHAT THIS IS NOT:
 * - Not a public HTTP route. No route is added in this
 *   change. A future route, if one is ever added, must pass
 *   the authenticated principal, or it must not exist.
 * - Not live HTTP traffic and not a native Muse window
 *   integration. "Wiring" here means exactly: panel callback
 *   -> existing server method, with principal and tenant
 *   checks in between, plus tests. Live routes and a native
 *   Muse window renderer remain separate steps and are NOT
 *   claimed here.
 * - Not a new approval, execution, or reminder path. Every
 *   handler delegates to an existing server method only:
 *   approve -> the host's existing signed-draft approval
 *   flow (dispatch of execute_approved_purchase, which
 *   verifies and consumes the approval exactly once);
 *   resume -> the host's existing resumeDraft() (which
 *   revalidates first); reminder opt-in -> optInToReminder();
 *   reminder opt-out/dismiss -> optOutOfReminder(). If a
 *   dependency is absent, the handler fails closed instead
 *   of inventing a path.
 *
 * SAFETY RULES, ENFORCED IN CODE:
 * 1. NO PRINCIPAL, NO CALL. A handler with no authenticated
 *    principal (empty subject or companyId) throws
 *    muse_panel_host_principal_required and never calls a
 *    dependency. A callback with no draftId throws
 *    muse_panel_host_draft_required.
 * 2. TENANT CHECK FIRST. companyId must equal
 *    principal.companyId, or the handler throws
 *    provider_readiness_company_mismatch before any
 *    dependency call. The reminder handlers pass only the
 *    principal's own companyId, so a panel can never opt
 *    another company into a reminder.
 * 3. APPROVAL IS NEVER PANEL-GRANTED. onApprove requires a
 *    host-supplied approval token; without one it throws
 *    approval_token_required and never calls the approval
 *    dependency. With one, it delegates to the existing
 *    approval flow, which verifies the token against the
 *    signed draft (hash, amount, currency, payment
 *    authorization) and consumes it exactly once. A
 *    tampered, expired, or changed draft fails or
 *    reapprovals inside that flow — this adapter never
 *    converts a failure into an approval, and it never
 *    retries a failure.
 * 4. APPROVE IS IN-FLIGHT GUARDED HERE TOO. The panel
 *    already disables its button on click; this adapter
 *    also refuses a second concurrent onApprove call
 *    without calling the approval dependency again, so a
 *    double dispatch through this adapter can never create
 *    a second execution claim. The guard resets when the
 *    first call settles, so a failed approval can be
 *    retried by an explicit new click — that retry is a
 *    new approval attempt through the same consume-once
 *    flow, never an automatic retry.
 * 5. RESUME NEVER RE-BUYS. onResume delegates to
 *    resumeDraft(), which returns present_review,
 *    reapproval_required, or execution_state. This adapter
 *    returns that decision unchanged: it never turns an
 *    execution state into a fresh Buy, and it never
 *    executes anything itself.
 * 6. REMINDER IS EXPLICIT ONLY. onReminderOptIn delegates
 *    to optInToReminder() with the principal only; mounting
 *    or rendering the panel never calls it, and the default
 *    remains OFF. onReminderOptOut delegates to
 *    optOutOfReminder() with action 'dismiss', which kills
 *    the pending reminder. A reminder is generic and
 *    one-only by the reminder module's own rules; this
 *    adapter adds no content, price, seller, or pitch.
 *
 * PRODUCTION BINDING (how a host wires this, documented
 * here so the adapter is not mistaken for a live route):
 * - approve: AuthenticatedMuseCommerceHost.dispatch({
 *     action: 'execute_approved_purchase', args: {draftId} })
 *   on a host constructed with the authenticated session's
 *   approvalToken in its MuseAgentRequest. The panel never
 *   supplies that token.
 * - resume: AuthenticatedMuseCommerceHost.resumeDraft({
 *     changedSinceReview, now }) on the same host.
 * - optIn: optInToReminder({store, principalSubject,
 *     principalCompanyId, companyId: principalCompanyId,
 *     draftId, now}) with the host's reminder store.
 * - optOut: optOutOfReminder({...same, action: 'dismiss',
 *     now}).
 * Until a host actually passes those bound methods, this
 * adapter is a tested mapping, not live panel-to-API
 * traffic — and that distinction is stated, not hidden.
 */

import type {
  MuseResumeDecision,
} from './muse-abandoned-recovery.js';
import type {
  MuseReminderRecord,
} from './muse-reminder.js';

export interface MusePanelHostPrincipal {
  subject: string;
  companyId: string;
}

export interface MusePanelHostDraft {
  draftId: string;
  /** Host-supplied approval token, from the authenticated session only. Never from the panel. */
  approvalToken?: string;
}

/** Existing server methods, injected by the host. No new method is invented here. */
export interface MusePanelHostDependencies {
  /** Existing signed-draft approval flow (host dispatch of execute_approved_purchase). */
  approveDraft: (args: {
    principal: MusePanelHostPrincipal;
    draftId: string;
    approvalToken: string;
  }) => Promise<unknown>;
  /** Existing host resume path (host resumeDraft). */
  resumeDraft: (args: {
    principal: MusePanelHostPrincipal;
    draftId: string;
    changedSinceReview?: boolean;
    now?: string;
  }) => Promise<MuseResumeDecision>;
  /** Existing reminder opt-in (optInToReminder). */
  optInReminder: (args: {
    principal: MusePanelHostPrincipal;
    draftId: string;
    now: string;
  }) => Promise<MuseReminderRecord>;
  /** Existing reminder opt-out/dismiss (optOutOfReminder). */
  optOutReminder: (args: {
    principal: MusePanelHostPrincipal;
    draftId: string;
    now: string;
  }) => Promise<MuseReminderRecord | null>;
}

/** Panel-shaped handlers: callbacks taking no arguments, exactly as the panel expects. */
export interface MusePanelHostHandlers {
  onApprove: () => Promise<void>;
  onResume: () => Promise<MuseResumeDecision>;
  onReminderOptIn: () => Promise<MuseReminderRecord>;
  onReminderOptOut: () => Promise<MuseReminderRecord | null>;
}

function requirePrincipal(principal: MusePanelHostPrincipal): MusePanelHostPrincipal {
  if (!principal || typeof principal.subject !== 'string' || !principal.subject.trim()) {
    throw new Error('muse_panel_host_principal_required');
  }
  if (typeof principal.companyId !== 'string' || !principal.companyId.trim()) {
    throw new Error('muse_panel_host_principal_required');
  }
  return {subject: principal.subject, companyId: principal.companyId};
}

function requireDraftId(draftId: unknown): string {
  if (typeof draftId !== 'string' || !draftId.trim()) throw new Error('muse_panel_host_draft_required');
  return draftId;
}

function checkTenant(principal: MusePanelHostPrincipal, companyId: string): void {
  if (companyId !== principal.companyId) throw new Error('provider_readiness_company_mismatch');
}

/**
 * Build the panel handlers for one authenticated host session.
 * `companyId` is the company the host is acting for; it must
 * equal principal.companyId, or construction itself throws —
 * a wiring built for the wrong company never reaches a
 * handler call. `now` is server time, supplied by the host.
 */
export function createMusePanelHostHandlers(args: {
  principal: MusePanelHostPrincipal;
  companyId: string;
  draft: MusePanelHostDraft;
  deps: MusePanelHostDependencies;
  now?: string;
}): MusePanelHostHandlers {
  const principal = requirePrincipal(args.principal);
  checkTenant(principal, args.companyId);
  const draftId = requireDraftId(args.draft.draftId);
  const approvalToken = args.draft.approvalToken;
  const now = args.now ?? new Date().toISOString();
  let approveInFlight = false;

  return {
    async onApprove(): Promise<void> {
      requirePrincipal(principal);
      checkTenant(principal, args.companyId);
      if (!approvalToken) throw new Error('approval_token_required');
      if (approveInFlight) return;
      approveInFlight = true;
      try {
        await args.deps.approveDraft({principal, draftId, approvalToken});
      } finally {
        approveInFlight = false;
      }
    },
    async onResume(): Promise<MuseResumeDecision> {
      requirePrincipal(principal);
      checkTenant(principal, args.companyId);
      // The decision is returned unchanged: present_review,
      // reapproval_required, or execution_state. The host
      // then calls the panel's update() with the review,
      // reapproval, or status state — this adapter never
      // renders a review and never offers a fresh Buy.
      return args.deps.resumeDraft({principal, draftId, now});
    },
    async onReminderOptIn(): Promise<MuseReminderRecord> {
      requirePrincipal(principal);
      checkTenant(principal, args.companyId);
      return args.deps.optInReminder({principal, draftId, now});
    },
    async onReminderOptOut(): Promise<MuseReminderRecord | null> {
      requirePrincipal(principal);
      checkTenant(principal, args.companyId);
      return args.deps.optOutReminder({principal, draftId, now});
    },
  };
}
