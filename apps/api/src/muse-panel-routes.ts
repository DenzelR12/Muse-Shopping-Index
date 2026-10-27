/**
 * Muse feature panel routes — pure handler logic, NOT YET MOUNTED.
 *
 * Muse Shopping Index is a Muse feature, not a storefront. The panel is a
 * Muse feature panel mounted by a Muse host inside a Muse window/surface.
 * Its callbacks already have a tested mapping to existing server methods
 * (apps/api/src/muse-panel-host.ts, createMusePanelHostHandlers). This
 * module is the next layer only: a request-shaped wrapper around those
 * handlers, with the same fail-closed rules, so that a future HTTP mount
 * has exactly one contract to follow and cannot invent its own.
 *
 * WHAT THIS IS NOT — read before mounting anything:
 * - Not a mounted HTTP route. Nothing in this file registers a route in
 *   apps/api/src/index.ts, parses an HTTP body, or reads an auth header.
 *   Until a mount exists that supplies the principal from server
 *   authentication, there is NO live panel-to-API route, and no panel
 *   HTTP traffic is claimed. See docs/live-panel-routes-design.md for the
 *   mount contract that must be followed.
 * - Not an authentication layer. The caller MUST supply the principal
 *   from server authentication. A principal taken from a request body,
 *   a caption, model text, or a DOM field must be refused by the mount;
 *   this module cannot tell where its caller got the principal, so it
 *   trusts the mount to do that — and the design doc makes that the
 *   mount's explicit, auditable duty.
 * - Not a new approval, execution, or reminder path. Every action
 *   delegates to the already-bound panel host handlers, which delegate
 *   to existing server methods. This module adds only request validation
 *   and error-to-status mapping.
 *
 * FAIL-CLOSED RULES, ENFORCED HERE:
 * 1. No principal (empty subject or companyId) -> 401
 *    muse_panel_route_principal_required, no handler called.
 * 2. companyId != principal.companyId -> 403
 *    provider_readiness_company_mismatch, no handler called.
 * 3. No draftId, or a draftId that is not the draft the handlers were
 *    bound to -> 400 muse_panel_route_draft_required /
 *    muse_panel_route_draft_mismatch, no handler called.
 * 4. Unknown action -> 400 muse_panel_route_action_unknown.
 * 5. Approval without a host-supplied session token -> the handler throws
 *    approval_token_required and this module returns 403 with that error;
 *    the approval flow is never reached, and the failure is never
 *    converted into an approval and never auto-retried.
 * 6. A tampered, expired, or changed draft fails inside the existing
 *    approval/resume flow; this module returns its error name with a
 *    422 status and never retries it, never converts it to a success,
 *    and never offers a fresh Buy. A resume decision is returned
 *    unchanged (present_review, reapproval_required, or execution_state).
 * 7. The request body never supplies an approval token, a price, a
 *    title, or a payment method. There is no field for any of them, so
 *    a mount that forwards such a field is violating this contract.
 */

export interface MusePanelRoutePrincipal {
  subject: string;
  companyId: string;
}

export interface MusePanelRouteHandlers {
  onApprove: () => Promise<void>;
  onResume: () => Promise<unknown>;
  onReminderOptIn: () => Promise<unknown>;
  onReminderOptOut: () => Promise<unknown>;
}

export type MusePanelRouteAction =
  | 'approve'
  | 'resume'
  | 'reminder-opt-in'
  | 'reminder-opt-out';

export interface MusePanelRouteRequest {
  action: string;
  principal?: MusePanelRoutePrincipal | null;
  companyId?: string;
  draftId?: string;
  /** The draft the handlers were bound to, from server state only. */
  expectedDraftId: string;
  handlers: MusePanelRouteHandlers;
}

export type MusePanelRouteResponse =
  | { status: 200; body: { action: string; result: unknown } }
  | { status: 202; body: { action: 'approve'; result: 'submitted_for_approval_flow' } }
  | { status: number; body: { error: string } };

function fail(status: number, error: string): MusePanelRouteResponse {
  return { status, body: { error } };
}

export async function handleMusePanelRoute(
  request: MusePanelRouteRequest,
): Promise<MusePanelRouteResponse> {
  const principal = request.principal;
  if (
    !principal ||
    typeof principal.subject !== 'string' ||
    !principal.subject.trim() ||
    typeof principal.companyId !== 'string' ||
    !principal.companyId.trim()
  ) {
    return fail(401, 'muse_panel_route_principal_required');
  }
  if (request.companyId !== principal.companyId) {
    return fail(403, 'provider_readiness_company_mismatch');
  }
  if (typeof request.draftId !== 'string' || !request.draftId.trim()) {
    return fail(400, 'muse_panel_route_draft_required');
  }
  if (request.draftId !== request.expectedDraftId) {
    return fail(400, 'muse_panel_route_draft_mismatch');
  }
  try {
    switch (request.action) {
      case 'approve': {
        await request.handlers.onApprove();
        // Accepted into the existing approval flow, not a claim that
        // execution succeeded: the flow verifies and consumes the
        // approval exactly once, and its outcome is reported by the
        // host's execution state, not by this route.
        return { status: 202, body: { action: 'approve', result: 'submitted_for_approval_flow' } };
      }
      case 'resume': {
        const decision = await request.handlers.onResume();
        return { status: 200, body: { action: 'resume', result: decision } };
      }
      case 'reminder-opt-in': {
        const record = await request.handlers.onReminderOptIn();
        return { status: 200, body: { action: 'reminder-opt-in', result: record } };
      }
      case 'reminder-opt-out': {
        const record = await request.handlers.onReminderOptOut();
        return { status: 200, body: { action: 'reminder-opt-out', result: record } };
      }
      default:
        return fail(400, 'muse_panel_route_action_unknown');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'muse_panel_route_failed';
    if (message === 'approval_token_required') return fail(403, message);
    if (message === 'provider_readiness_company_mismatch') return fail(403, message);
    return fail(422, message);
  }
}
