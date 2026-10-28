# Panel session token store + session mount — Muse Shopping Index

## Read first: code-ready, not live

Muse Shopping Index is a **Muse feature, not a storefront**. The panel
is mounted by a Muse host inside a Muse window/surface. Nothing in this batch creates a live panel route, live Postgres, live
seller, live reminder channel, or native Muse window. The index.ts
dispatch branches ARE now present in code (see §4), but they are
fail-closed only: no success path exists yet, so no live panel-to-API
traffic is claimed. This doc closes the
precise mount blocker from `docs/live-panel-routes-design.md` §5 in
code, and gives the exact, auditable step that still has to happen
before a route may be described as live.

## 1. What was missing, and what now exists

`index.ts` had no store mapping an authenticated panel session to an
approval token per draft, so the mount adapter
(`apps/api/src/muse-panel-mount.ts`) could only be given a
caller-supplied resolver — and a mount that invents a token, reads
one from the body, or reuses another session's token must not exist.
So approval through the panel stayed refused, correctly.

Now, in code:

| Piece | File | Role |
| --- | --- | --- |
| Session store | `apps/api/src/muse-panel-session-store.ts` | Server-owned draftId → approval token, scoped to session + principal, expiring with the draft. Memory store for tests; Postgres store (`muse_panel_session_tokens`) for the server, following the Postgres+memory pattern in `muse-generic-profile.ts`. |
| Session mount | `apps/api/src/muse-panel-session-mount.ts` | Binds the store to `handleMusePanelMount`. Fails closed when no store is configured; verifies the session before any handler is built or called. |
| Tests | `apps/api/test/muse-panel-session-store.test.ts` | Issue / resolve / expire / principal-mismatch / draft-mismatch / consume-once, plus mount refusals and one successful approve delegation. |
| CI-listed gate | `apps/api/test/provider-readiness.test.ts` (appended) | No-store → 503 and missing-session → 403, calling no handler. |
| Design contract | `docs/live-panel-routes-design.md` §6 | Records that the store exists in code and the index.ts wiring is still not applied. |

## 2. Store contract

- **Issue** takes `sessionId, subject, companyId, draftId,
  approvalToken, draftExpiresAt` — all from the authenticated
  session and the server-owned draft, never from a panel body, a
  caption, model text, or a DOM field. An expiry at or before `now`
  is rejected (`muse_panel_session_expiry_invalid`). The store never
  extends a draft's life: the existing panel design uses a 10-minute
  draft life, and that life is supplied by the caller as
  `draftExpiresAt`.
- **Verify** returns `valid` (with the token, internally only) or
  `missing`, `principal_mismatch`, `draft_mismatch`, `expired`, or
  `consumed`. A failed verification never returns a token.
- **Resolve** returns the token only for a valid session, otherwise
  `undefined`. It is an internal server-side resolution, never an
  HTTP response, never a panel field, never logged.
- **Consume** marks a token spent, once: a second consume returns
  `false`, and a consumed token resolves to nothing.
- **PurgeExpired** deletes rows whose draft expiry has passed and
  returns the count. The server operator runs it; no cron or job is
  created by this batch.
- **Tenant isolation**: a record is keyed by sessionId (one draft
  in view per session; a re-issue supersedes the previous draft's
  token) and checked against the principal's subject + companyId
  and the stored draftId. Another
  company's principal resolves nothing, and the mount maps that to
  403 `provider_readiness_company_mismatch`.
- **Postgres column note**: the token is stored (not hashed) because
  the host needs the actual token for the existing approval flow.
  That column is therefore server-only: selected only by this
  module's resolve path, never in any HTTP body, never logged, and
  every row expires with its draft. If the database is not
  server-only, do not use the Postgres store.

## 3. Mount contract (fail-closed order)

`createPanelSessionMount({ store, resolveDraft, hostDeps })` returns
`handlePanelSessionRequest({ principal, sessionId, draftId, action })`.
Before any handler is called, in order:

1. No principal → 401 `muse_panel_route_principal_required`.
2. No store → 503 `muse_panel_session_store_not_configured`.
3. No sessionId → 400 `muse_panel_session_id_required`.
4. Session missing → 403 `muse_panel_session_token_not_found`.
5. Principal mismatch → 403 `provider_readiness_company_mismatch`.
6. Draft mismatch → 400 `muse_panel_route_draft_mismatch`.
7. Expired → 410 `muse_panel_session_token_expired`.
8. Consumed **and** action is `approve` → 403
   `muse_panel_session_token_consumed`.

Then it delegates to `handleMusePanelMount`, whose own checks
(draft existence, draft company, draft match, approval without a
token) still run. A mount bug is therefore caught twice, not zero
times. `createSessionTokenResolver(store, sessionId)` is also
exported for an index.ts wiring that calls the adapter directly.

**Consumed tokens and resume, deliberately:** a consumed token
blocks `approve` (approve spends an approval) but not `resume`,
`reminder-opt-in`, or `reminder-opt-out`. Resume is a
revalidate-first read: expired/changed → new draft + diff + fresh
approval; approved/executing → execution state, never a fresh Buy
or second execution. Blocking resume after approval would hide the
execution state the panel must show, and it would not prevent a
second execution — the existing approval flow's consume-once is
what prevents that, and it is unchanged.

## 4. The index.ts splice (APPLIED in code, fail-closed only — NOT a live route)

The splice is now present in `apps/api/src/index.ts` (imports, a
Postgres-when-pool store, a `createPanelSessionMount` built from server
state, and four dispatch branches after server authentication:
POST /v1/muse/panel/approve, /resume, /reminder-opt-in,
/reminder-opt-out). What it does, honestly:

- No pool (no DATABASE_URL) → every panel request returns 503
  `muse_panel_session_store_not_configured`, calling no handler.
- With a pool but no authenticated panel session → 400
  `muse_panel_session_id_required`, calling no handler. index.ts has
  no authenticated panel session yet, so this is the outcome for every
  request that reaches the branches today.
- The body carries only `{ draftId }` (validated, max 160 chars);
  any token, price, title, payment method, or company ID in the body
  is ignored, never read. Principal is principal.orgId from server
  authentication, never a body field.
- `resolveDraft` returns null (no server-owned draft store is wired
  in index.ts) and hostDeps are defensive stubs that throw
  `muse_panel_host_not_configured` if ever called. They are
  unreachable while no session token can exist, and they must be
  replaced with real server methods before any success path exists.

What is still missing before anyone may describe a panel route as
live or working: (1) a session-issuance path at draft creation, (2)
an authenticated panel session ID for index.ts to use, (3) a real
server-owned draft lookup, (4) real panel host methods
(approveDraft / resumeDraft / optInReminder / optOutReminder),
(5) a full server build with the branches passing in CI, (6) a local
full-server run showing each refusal calling no handler, and (7) a
real-browser confirmation run (live-panel-routes-design §4). Until
all seven are recorded, the mount is code, not a live route.

The splice itself was verified in a typecheck harness (real
`tsc --strict`, real panel modules, exit 0) and at runtime (503
without a pool, 400 without a session, no handler called). A full
repo `pnpm build` / `pnpm typecheck` in the real workspace was NOT
run in that harness, so CI is still the full-build check — do not
claim it until CI passes.

The original splice text, kept for audit (the placeholders are now
the explicit null / throwing-stub choices above, not hidden):

```ts
// In apps/api/src/index.ts, built from server state at startup:
import { MemoryPanelSessionTokenStore, PostgresPanelSessionTokenStore }
  from './muse-panel-session-store.js';
import { createPanelSessionMount } from './muse-panel-session-mount.js';

// Postgres when a pool exists, memory only in tests — never both
// invented, never a token from a request body:
const panelSessionStore = pool
  ? new PostgresPanelSessionTokenStore(pool)
  : null; // null = mount refuses every panel request with 503
const panelSessionMount = createPanelSessionMount({
  store: panelSessionStore,
  resolveDraft: /* server-owned draft lookup for this principal */,
  hostDeps: /* existing server methods: approveDraft, resumeDraft,
    optInReminder, optOutReminder */,
});

// Dispatch branch (after authenticateRequest, principal from server
// authentication only; body carries only { draftId, action }):
//   POST /v1/muse/panel/approve        -> action 'approve'
//   POST /v1/muse/panel/resume         -> action 'resume'
//   POST /v1/muse/panel/reminder-opt-in  -> action 'reminder-opt-in'
//   POST /v1/muse/panel/reminder-opt-out -> action 'reminder-opt-out'
// Each branch calls panelSessionMount.handlePanelSessionRequest()
// with the authenticated principal and the authenticated session's
// ID, and returns its status/body unchanged. No branch may read a
// token, price, title, payment method, or company ID from the body.
```

Before anyone calls that route live, the verification in
`docs/live-panel-routes-design.md` §4 must be recorded: (1) full
server build with the dispatch branch, (2) panel-routes tests plus
the provider-readiness gate passing in CI, (3) a local full-server
run with test-only auth showing each refusal case calling no
handler and each success case delegating exactly once, and (4) a
real-browser confirmation run. Until all four are recorded, the
mount is code, not a live route.

## 5. What this does NOT change

- No approval, execution, or reminder path is created; every action
  delegates to existing server methods through existing host wiring.
- No native Muse window, live reminder channel, live seller,
  payment, Shop handling, or catalog read is created.
- No secret, token value, or approval token is in this code, its
  tests, or this doc — only field names and error names.
- The standalone test file `muse-panel-session-store.test.ts` is
  **not** itself a ci.yml line (workflow files are user-only); its
  CI coverage is the appended provider-readiness gate, which is a
  ci.yml-listed file. Do not claim the standalone file as CI-listed.
