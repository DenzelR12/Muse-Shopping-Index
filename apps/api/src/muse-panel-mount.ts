/**
 * Muse feature panel mount adapter — Muse Shopping Index.
 *
 * Muse feature, not a storefront. This module is the mount layer for the
 * Muse feature panel, written so that mounting a panel route in
 * apps/api/src/index.ts is a small, auditable wiring step — not a new
 * design invented at mount time.
 *
 * WHAT THIS IS:
 * A pure, injectable adapter around the already-tested layers:
 *   createMusePanelHostHandlers (apps/api/src/muse-panel-host.ts)
 *   -> handleMusePanelRoute (apps/api/src/muse-panel-routes.ts)
 * The caller (the future index.ts mount) supplies, from server state
 * only, everything the panel must never supply:
 * - the authenticated principal (subject + companyId), resolved by the
 *   server's own authentication, never from a request body, a caption,
 *   model text, or a DOM field;
 * - a draft resolver that returns the server-owned draft for this
 *   principal (draftId + companyId), or null when no such draft exists;
 * - an approval-token resolver that returns the approval token from
 *   the authenticated session only, or undefined when the session has
 *   none. The token is NEVER taken from the request body: the body
 *   carries only { draftId, action } and this module has no field for
 *   a token, a price, a title, or a payment method.
 * - the host dependencies (approveDraft / resumeDraft / optInReminder /
 *   optOutReminder) from existing server methods.
 *
 * WHAT THIS IS NOT — read before wiring it into index.ts:
 * - Not a mounted HTTP route. Nothing in this file registers a route,
 *   parses an HTTP body, or reads an auth header. Wiring it into
 *   index.ts is still a separate, separately verifiable step, and
 *   until that wiring exists there is NO live panel-to-API route.
 * - Not a session store. This adapter does not invent one. index.ts
 *   today has no store mapping an authenticated panel session to an
 *   approval token per draft, and the /v1/muse/agent host is a
 *   per-request model host, not a panel session. That missing session
 *   store is the precise mount blocker documented in
 *   docs/live-panel-routes-design.md §5 and docs/product-100-checklist.md:
 *   the mount must be given a real resolveApprovalToken, or approval
 *   through the panel must stay refused (approval_token_required).
 *   A mount that invents a token, reads one from the body, or reuses
 *   another session's token violates this contract and must not exist.
 * - Not a new approval, execution, or reminder path. Every action
 *   delegates to existing server methods through the existing panel
 *   host wiring. This adapter adds only mount validation: principal,
 *   draft existence, draft ownership, and draft match, in that order,
 *   before any handler is built or called.
 *
 * FAIL-CLOSED RULES, ENFORCED HERE, BEFORE ANY HANDLER CALL:
 * 1. No principal (empty subject or companyId) -> 401
 *    muse_panel_route_principal_required.
 * 2. Draft resolver returns null -> 404 muse_panel_mount_draft_not_found.
 * 3. Resolved draft's companyId != principal.companyId -> 403
 *    provider_readiness_company_mismatch.
 * 4. Body draftId != resolved draftId -> 400 muse_panel_route_draft_mismatch.
 * 5. Unknown action -> 400 muse_panel_route_action_unknown (via the
 *    routes module; no handler is called).
 * 6. Approval with no session token -> 403 approval_token_required
 *    (via the host wiring; the approval flow is never reached).
 * 7. Any handler error is returned with its error name (422, or 403
 *    for approval_token_required / company mismatch) and is never
 *    retried, never converted into a success, and never turned into
 *    a fresh Buy or a second execution.
 */

import {
  createMusePanelHostHandlers,
  type MusePanelHostDependencies,
  type MusePanelHostPrincipal,
} from './muse-panel-host.js';
import {
  handleMusePanelRoute,
  type MusePanelRouteResponse,
} from './muse-panel-routes.js';

export interface MusePanelMountPrincipal extends MusePanelHostPrincipal {}

export interface MusePanelMountDraft {
  draftId: string;
  companyId: string;
}

export interface MusePanelMountDependencies {
  /** Server-owned draft lookup for this principal. Null = no such draft. */
  resolveDraft: (args: {
    principal: MusePanelMountPrincipal;
    draftId: string;
  }) => Promise<MusePanelMountDraft | null>;
  /**
   * Approval token from the authenticated session only. Undefined =
   * the session has no token for this draft, so approval must refuse.
   * Never a body field, never another session's token.
   */
  resolveApprovalToken: (args: {
    principal: MusePanelMountPrincipal;
    draftId: string;
  }) => Promise<string | undefined>;
  /** Existing server methods, injected by the host. */
  hostDeps: MusePanelHostDependencies;
  now?: string;
}

export type MusePanelMountAction =
  | 'approve'
  | 'resume'
  | 'reminder-opt-in'
  | 'reminder-opt-out';

export async function handleMusePanelMount(args: {
  principal: MusePanelMountPrincipal | null | undefined;
  draftId: string;
  action: string;
  deps: MusePanelMountDependencies;
}): Promise<MusePanelRouteResponse> {
  const principal = args.principal;
  if (
    !principal ||
    typeof principal.subject !== 'string' ||
    !principal.subject.trim() ||
    typeof principal.companyId !== 'string' ||
    !principal.companyId.trim()
  ) {
    return { status: 401, body: { error: 'muse_panel_route_principal_required' } };
  }
  if (typeof args.draftId !== 'string' || !args.draftId.trim()) {
    return { status: 400, body: { error: 'muse_panel_route_draft_required' } };
  }
  const draft = await args.deps.resolveDraft({ principal, draftId: args.draftId });
  if (!draft) {
    return { status: 404, body: { error: 'muse_panel_mount_draft_not_found' } };
  }
  if (draft.companyId !== principal.companyId) {
    return { status: 403, body: { error: 'provider_readiness_company_mismatch' } };
  }
  if (draft.draftId !== args.draftId) {
    return { status: 400, body: { error: 'muse_panel_route_draft_mismatch' } };
  }
  const approvalToken = await args.deps.resolveApprovalToken({
    principal,
    draftId: draft.draftId,
  });
  const handlers = createMusePanelHostHandlers({
    principal,
    companyId: principal.companyId,
    draft: { draftId: draft.draftId, approvalToken },
    deps: args.deps.hostDeps,
    now: args.deps.now,
  });
  return handleMusePanelRoute({
    action: args.action,
    principal,
    companyId: principal.companyId,
    draftId: draft.draftId,
    expectedDraftId: draft.draftId,
    handlers,
  });
}
