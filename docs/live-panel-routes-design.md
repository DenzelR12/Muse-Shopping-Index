# Live panel-to-API routes — design contract (not mounted)

## Limits — read first

- **Design only. No live route exists.** The pure handler logic is in
  `apps/api/src/muse-panel-routes.ts` with tests in
  `apps/api/test/muse-panel-routes.test.ts` and a provider-readiness
  gate. Nothing in this batch mounts a route in
  `apps/api/src/index.ts`, and no live panel-to-API traffic is claimed.
  A route that is not mounted does not exist, however good its handler
  is.
- **Muse feature, not a storefront.** These routes, when mounted, serve
  the Muse feature panel mounted by a Muse host inside a Muse window /
  surface. They never serve a shop site, cart page, checkout page, or
  product-listing page, and they never expose a product catalog.
- **Why not mounted in this batch.** `apps/api/src/index.ts` is a
  large monolithic server file whose dispatch, authentication, and
  store wiring are built at startup from Postgres, secrets, and
  operator configuration. Splicing a new dispatch branch into that
  file from a file-only push, without running the full server build,
  would risk breaking existing routes for an unverifiable gain. The
  handler module is therefore written so that mounting is a small,
  auditable, separately verifiable step — and this document is its
  contract, so the mount cannot be improvised later.

## 1. Proposed routes (PROPOSED — not mounted, not live)

All four routes share one shape. The body carries only the draft the
panel is showing and the action. It never carries an approval token,
a price, a title, a payment method, or a company ID chosen by the
caller.

| Proposed method + path | Action | Body (only these fields) |
| --- | --- | --- |
| POST /v1/muse/panel/approve | approve | `{ "draftId": "<server draft id>" }` |
| POST /v1/muse/panel/resume | resume | `{ "draftId": "<server draft id>" }` |
| POST /v1/muse/panel/reminder-opt-in | reminder-opt-in | `{ "draftId": "<server draft id>" }` |
| POST /v1/muse/panel/reminder-opt-out | reminder-opt-out | `{ "draftId": "<server draft id>" }` |

Response shapes follow `handleMusePanelRoute` exactly: approve returns
202 `submitted_for_approval_flow` (accepted, not executed); resume
returns the decision unchanged (200); reminder actions return the
record (200); failures return 401 / 403 / 400 / 422 with the error
name in the body. No route ever returns a token, a raw ID, or a
payment identifier.

## 2. Mount duties (the mount must do all of these, or not exist)

1. **Principal from server authentication only.** The mount resolves
   the principal (subject + companyId) from the server's own
   authentication (the same `authenticateRequest` path used by
   existing routes), never from the body, a header chosen by the
   panel, a caption, or model text. If the mount cannot resolve a
   principal, it must refuse (401) before calling any handler.
2. **Tenant check before any handler call.** `companyId` is the
   principal's own companyId, never a body field. A mismatch is 403
   `provider_readiness_company_mismatch` before any dependency call.
   (The handler module enforces this again, so a mount bug is caught
   twice, not zero times.)
3. **Handlers bound from server state.** The mount builds the panel
   host handlers (`createMusePanelHostHandlers`) from the authenticated
   session — principal, the server-owned draft, and the approval token
   from the authenticated session only — then passes them to
   `handleMusePanelRoute` with `expectedDraftId` equal to the
   server-owned draft's ID. The panel never supplies the token.
4. **Draft match.** The body's `draftId` must equal the server-owned
   draft's ID, or the route returns 400 and calls no handler.
5. **No auto-retry, no conversion.** A handler error is returned with
   its error name (422, or 403 for `approval_token_required`). The
   mount never retries a failed approval, never converts a failure
   into a success, and never turns an execution state into a fresh
   Buy.
6. **No new unauthenticated surface.** If any of duties 1–3 cannot be
   met in the mount's environment, the route must not be mounted in
   that environment. A panel route without authentication is worse
   than no panel route.

## 3. What mounting does NOT change

- No approval, execution, or reminder path is created. Every action
  delegates to an existing server method through the existing panel
  host wiring.
- No native Muse window renderer is created. Mounting a route does
  not integrate with Meta, and does not claim a native Muse window.
- No live reminder channel is created. Opt-in wiring exists; sending
  still requires an authorized channel registered at startup, which
  is not configured.
- No live seller, payment, Shop handling, or catalog read is created.
  Those need their own authorizations and verifications (see
  `docs/technical-verification-checklist.md`).

## 4. Verification for the mount (when it happens)

The mount is verified only by, in order: (1) a full server build with
the dispatch branch, (2) the existing panel-routes tests plus the
provider-readiness gate passing in CI, (3) a local full-server run
with test-only auth showing each refusal case (no principal, tenant
mismatch, draft mismatch, no token) calling no handler, and each
success case delegating exactly once, and (4) a real-browser
confirmation run (see the technical verification checklist). Until
all four are recorded, the mount is code, not a live route — and it
must be described that way.

## 5. Mount adapter (new in the 100% batch) and the precise mount blocker

`apps/api/src/muse-panel-mount.ts` (`handleMusePanelMount`) is now
the mount layer, with tests in `apps/api/test/muse-panel-mount.test.ts`
and a provider-readiness gate. It is pure and injectable: it takes an
authenticated principal, a body `{ draftId, action }` only, a
draft resolver, a session-token resolver, and existing host
dependencies, and it enforces, before any handler is built or called:
principal required (401), draft found (404
`muse_panel_mount_draft_not_found`), draft company = principal
company (403), body draftId = resolved draftId (400), unknown action
(400), and approval with no session token (403
`approval_token_required`, approval flow never reached).

**Precise mount blocker — why index.ts is still not wired:**
index.ts has no store mapping an authenticated panel session to an
approval token per draft, and the /v1/muse/agent host is a per-request
model host, not a panel session. There is also no reminder store
wired into a panel path in index.ts. Wiring the adapter into index.ts
therefore requires, first, a server-owned panel session token store
(draftId → approval token, scoped to the authenticated session and
principal, expiring with the draft, never readable from the panel).
Until that store exists and is wired, panel routes stay code-ready,
not mounted — and that is the correct fail-closed state. A mount
that reads a token from the body, invents one, or reuses another
session's token must not exist. Mounting the adapter does not create
live traffic, a native Muse window, a live reminder channel, a live
seller, or a live catalog read; those remain separately gated.

## 6. Session store now exists in code — mount still not applied (new)

The blocker in §5 is now closed in code, not in a live route:

- `apps/api/src/muse-panel-session-store.ts` — server-owned store
  (memory for tests, Postgres table `muse_panel_session_tokens` for
  the server), with issue / verify / resolve / consume /
  purgeExpired, expiring with the draft, never panel-readable.
- `apps/api/src/muse-panel-session-mount.ts` — binds that store to
  `handleMusePanelMount`, failing closed with 503
  `muse_panel_session_store_not_configured` when no store is
  configured, and with distinct 403 / 400 / 410 / 403 errors for
  missing / principal-mismatched / draft-mismatched / expired /
  consumed (approve only) tokens.
- Tests in `apps/api/test/muse-panel-session-store.test.ts`, with a
  gate in the CI-listed `apps/api/test/provider-readiness.test.ts`.
  Full design: `docs/muse-panel-session-store.md`.

What has NOT changed: `apps/api/src/index.ts` is still not wired
to these modules in this batch. The splice in the session-store doc
is a small, auditable step that still needs a full server build,
the panel-routes tests plus the provider-readiness gate in CI, a
local full-server run showing each refusal case calling no handler,
and a real-browser confirmation run (§4) before anyone may describe
a panel route as live. Until then, panel routes are code-ready,
not mounted, and no live panel-to-API traffic is claimed.

## 7. Index.ts splice applied in code — fail-closed only (new)

`apps/api/src/index.ts` now contains the four dispatch branches
(POST /v1/muse/panel/approve, /resume, /reminder-opt-in,
/reminder-opt-out), built from server state with a Postgres-when-pool
session store and `createPanelSessionMount`. This changes §6's
"still not applied" status in one narrow sense only: the wiring
exists in code. It does NOT change the live status: no session
issuance, no authenticated panel session, no real draft lookup, and
no real host methods exist in index.ts yet, so every request through
the branches refuses today (503 without a pool, 400 without a
session) and no handler is ever called. The verification in §4 is
therefore still incomplete: full server build in CI, local
full-server refusal run, and real-browser confirmation are all still
outstanding. Until they are recorded, panel routes are code-ready,
not mounted in any live sense, and no live panel-to-API traffic,
live Postgres, live seller, or native Muse window is claimed. See
`docs/muse-panel-session-store.md` §4 for the exact splice and its
remaining gaps.
