# Panel live wiring — session issuance, draft lookup, real host methods

**Status:** in code, CI-gated via `provider-readiness.test.ts` (see below). Not live panel traffic yet — one gap remains, named honestly at the end.

## What was built (HEAD, this batch)

**1. Server-owned draft lookup — `PanelDraftRegistry` (`muse-panel-live-wiring.ts`)**
- Memory + Postgres (`muse_panel_drafts`, primary key `draft_id`). Postgres `INSERT ... ON CONFLICT DO NOTHING` keeps a draft's company stable; a re-register for a different company fails closed with tenant mismatch.
- `registerDraft()` is server-internal only. There is no HTTP route for it, and a draft is never created from a body, caption, or model text.
- `resolveDraft()` returns a draft only for its own company, only while unexpired. Expired or unknown drafts return null → mount 404, fail closed.

**2. Session issuance — `issuePanelSession()`**
- Inputs, all server-supplied: authenticated principal, registered draft, approval token from the authenticated session only (never a body field, DOM field, caption, or model text).
- Checks, in order: principal present, draft registered, draft company = principal company, draft unexpired (via the registry).
- SessionId is generated server-side with `crypto.randomUUID()` — never client-supplied — and issued into the existing panel session token store with the draft's expiry. It is returned to the server caller only, not as an HTTP response.

**3. Real host methods adapter — `createPanelLiveHostDeps()`**
- Wraps existing server methods (`approveDraft`, `resumeDraft`, `optInReminder`, `optOutReminder`, exactly as `muse-panel-host.ts` expects) with principal + tenant checks before any call, and an in-flight guard on approve so a second concurrent approve cannot create a second execution claim.
- Unbound methods fail closed with `muse_panel_host_not_configured` — the same error the old index.ts stubs threw, now routed through a real adapter.
- It never invents an approval, never converts a failure into a success, and never retries. Approval still goes through the existing signed-draft flow, which verifies and consumes the approval exactly once.

**4. index.ts splice**
- `resolveDraft: async () => null` is gone. Panel branches now use `panelDraftResolver(panelDraftRegistry)`.
- Host stubs are gone as a shape. Branches now use `createPanelLiveHostDeps({})` — unbound, so they fail closed at host binding.
- Comments in index.ts were updated to the new state; the old "no draft store, no issuance, no host methods" comments are removed.

## Tests

- Standalone: `apps/api/test/muse-panel-live-wiring.test.ts` — registered draft + issued session + mount approve (202, handler called once), resume / reminder opt-in / opt-out through the wired host, issuance fail-closed for unknown draft / other company / expired draft, cross-company re-register blocked, unbound host fails closed, concurrent approve guarded. This file is **not** in `ci.yml` (workflows permission — user-only), same as other standalone test files.
- **CI-gated:** the same issuance + mount-approve path is appended as a gate in `apps/api/test/provider-readiness.test.ts`, which CI does run. That gate is what CI actually verifies until a dedicated ci.yml line is added by the user.

## The one remaining gap — production host binding

index.ts panel branches authenticate a **company** principal (`orgId`). They have no consumer identity, no `connectionId`, and no approval token from an authenticated panel session. The existing approval flow needs all three, via `AuthenticatedMuseCommerceHost` in `/v1/muse/agent` (which also requires `MUSE_AGENT_ENABLED=true` and a verified human identity).

Binding a fake consumer, a guessed connectionId, or a body-derived token here would violate the safety model, so this batch does **not** do it. Until a Muse host supplies a real authenticated panel session — registers a draft, issues a session via `issuePanelSession()`, and binds its host methods through `createPanelLiveHostDeps()` — live panel routes still refuse approve/resume/reminder, but now at host binding, with drafts and sessions actually resolvable.

That is a narrower, named gap than before: four gaps (issuance, session, draft, host) are now one (production host binding).
