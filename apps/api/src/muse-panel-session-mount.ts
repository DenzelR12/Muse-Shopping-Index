/**
 * Panel session mount — Muse Shopping Index.
 *
 * Muse feature, not a storefront. This is the wiring layer that closes
 * the precise mount blocker in docs/live-panel-routes-design.md §5:
 * it binds the existing panel mount adapter (muse-panel-mount.ts) to
 * the server-owned panel session token store (muse-panel-session-
 * store.ts), so a panel route in apps/api/src/index.ts can be mounted
 * with a real session-token resolver instead of an invented one.
 *
 * WHAT THIS IS:
 * A pure, injectable function, createPanelSessionMount(), that the
 * server builds once from server state only: a session store (or
 * null when none is configured), a draft resolver, and the existing
 * host dependencies. It returns handlePanelSessionRequest(), which
 * the future index.ts dispatch branch calls with the authenticated
 * principal (from server authentication, never from the body), a
 * sessionId (from the authenticated session, never from the panel),
 * and a body of { draftId, action } only. The body still carries no
 * token, price, title, payment method, or company ID.
 *
 * FAIL-CLOSED ORDER, BEFORE ANY HANDLER IS CALLED:
 * 1. No principal -> 401 muse_panel_route_principal_required.
 * 2. No store configured -> 503 muse_panel_session_store_not_configured.
 *    This is the mount gate: the route must not be mounted in an
 *    environment without a store, and if it is called there anyway,
 *    it refuses instead of inventing a token or falling back to an
 *    unscoped resolver.
 * 3. No sessionId -> 400 muse_panel_session_id_required.
 * 4. Session verification (from the store, in order):
 *    - no record -> 403 muse_panel_session_token_not_found;
 *    - principal mismatch -> 403 provider_readiness_company_mismatch;
 *    - draft mismatch -> 400 muse_panel_route_draft_mismatch;
 *    - expired -> 410 muse_panel_session_token_expired;
 *    - consumed AND action is approve -> 403
 *      muse_panel_session_token_consumed.
 * 5. Delegation to handleMusePanelMount with a resolver that returns
 *    the store's token for this session/draft/principal only. All of
 *    the mount adapter's own checks (draft existence, draft company,
 *    draft match, approval without a token) still run, so a mount bug
 *    is caught twice, not zero times.
 *
 * CONSUMED TOKENS AND RESUME — READ THIS BEFORE CHANGING IT:
 * A consumed session token blocks approve, because approve spends an
 * approval. It does NOT block resume, reminder-opt-in, or
 * reminder-opt-out: resume is a revalidate-first read that must be
 * able to report "approved / executing" as execution state, and a
 * reminder action does not spend an approval. Blocking resume after
 * approval would hide the execution state the panel is required to
 * show, and it would not prevent a second execution — that is the
 * existing approval flow's consume-once job, not this mount's.
 *
 * WHAT THIS IS NOT:
 * - Not a mounted HTTP route. Nothing here registers a route, parses
 *   an HTTP body, or reads an auth header. The index.ts dispatch
 *   branch is a separate, separately verifiable step (see
 *   docs/muse-panel-session-store.md for the exact splice), and
 *   until it exists there is NO live panel-to-API route.
 * - Not a live Postgres, live seller, live reminder channel, or
 *   native Muse window. Mounting does not create any of those.
 * - Not a new approval or execution path. Every action delegates to
 *   existing server methods through the existing panel host wiring.
 */

import {
  handleMusePanelMount,
  type MusePanelMountDependencies,
  type MusePanelMountDraft,
  type MusePanelMountPrincipal,
  type MusePanelRouteResponse,
} from './muse-panel-mount.js';
import type {
  MusePanelSessionStore,
} from './muse-panel-session-store.js';

export interface MusePanelSessionMountConfig {
  /** Null = no store configured: every request fails closed with 503. */
  store: MusePanelSessionStore | null | undefined;
  resolveDraft: MusePanelMountDependencies['resolveDraft'];
  hostDeps: MusePanelMountDependencies['hostDeps'];
  now?: string;
}

export interface MusePanelSessionRequest {
  principal: MusePanelMountPrincipal | null | undefined;
  sessionId: string | null | undefined;
  draftId: string;
  action: string;
  now?: string;
}

export function createPanelSessionMount(config: MusePanelSessionMountConfig) {
  const store = config.store ?? null;

  function fail(status: number, error: string): MusePanelRouteResponse {
    return { status, body: { error } };
  }

  async function handlePanelSessionRequest(
    request: MusePanelSessionRequest,
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
    if (!store) {
      return fail(503, 'muse_panel_session_store_not_configured');
    }
    if (typeof request.sessionId !== 'string' || !request.sessionId.trim()) {
      return fail(400, 'muse_panel_session_id_required');
    }
    const sessionId = request.sessionId.trim();
    const now = request.now ?? config.now;
    const verification = await store.verifySession({
      sessionId,
      principal,
      draftId: request.draftId,
      now,
    });
    switch (verification.status) {
      case 'missing':
        return fail(403, 'muse_panel_session_token_not_found');
      case 'principal_mismatch':
        return fail(403, 'provider_readiness_company_mismatch');
      case 'draft_mismatch':
        return fail(400, 'muse_panel_route_draft_mismatch');
      case 'expired':
        return fail(410, 'muse_panel_session_token_expired');
      case 'consumed':
        if (request.action === 'approve') {
          return fail(403, 'muse_panel_session_token_consumed');
        }
        break;
      case 'valid':
        break;
      default:
        return fail(403, 'muse_panel_session_token_not_found');
    }
    const deps: MusePanelMountDependencies = {
      resolveDraft: config.resolveDraft,
      resolveApprovalToken: async (args: {
        principal: MusePanelMountPrincipal;
        draftId: string;
      }) =>
        store.resolveApprovalToken({
          sessionId,
          principal: args.principal,
          draftId: args.draftId,
          now,
        }),
      hostDeps: config.hostDeps,
      now,
    };
    return handleMusePanelMount({
      principal,
      draftId: request.draftId,
      action: request.action,
      deps,
    });
  }

  return { handlePanelSessionRequest };
}

/**
 * Resolver for index.ts: given a store and the authenticated session's
 * ID, returns the mount adapter's resolveApprovalToken shape. This is
 * the only resolver index.ts needs if it wires the adapter directly
 * instead of using createPanelSessionMount(). It never takes a token
 * from a request body.
 */
export function createSessionTokenResolver(
  store: MusePanelSessionStore,
  sessionId: string,
): MusePanelMountDependencies['resolveApprovalToken'] {
  return async (args: { principal: MusePanelMountPrincipal; draftId: string }) =>
    store.resolveApprovalToken({
      sessionId,
      principal: args.principal,
      draftId: args.draftId,
    });
}

export type { MusePanelMountDraft };
