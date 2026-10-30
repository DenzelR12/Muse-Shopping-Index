# Muse feature panel host wiring — callback to server method, nothing more

Status: wiring code only, in `apps/api/src/muse-panel-host.ts`
(`createMusePanelHostHandlers`). This document describes a
mapping, not a live product flow.

## The gap this closes

HEAD 11b51a3 delivered the Muse feature panel
(`apps/demo/src/muse-feature-panel.ts`,
`mountMuseFeaturePanel(container, state, handlers)`) as a tested
DOM module, and the server methods it needed — the host's
`resumeDraft()`, the signed-draft approval flow, and
`optInToReminder()` / `optOutOfReminder()` — but the panel's
callbacks were not mapped to those methods by any host-side
code, and the panel itself made no network call. This change
adds that mapping. It does not add a route, a renderer, or a
new server method.

## What "wiring" means here, exactly

The host builds the handlers from authenticated server state
only:

- the authenticated principal (subject + companyId), resolved
  by the server's own authentication;
- the draft the panel is showing (draftId), from the
  server-owned signed draft;
- the approval token, when one exists, from the authenticated
  session.

It passes the resulting handlers to `mountMuseFeaturePanel`.
The panel's handler shape takes no arguments, so identity,
tokens, and facts never travel through the DOM: the panel
cannot supply a subject, a company, a token, or a seller, and
this adapter never reads one from panel input.

| Panel callback | Existing server method it delegates to |
| --- | --- |
| `onApprove` | Host's existing signed-draft approval flow: dispatch of `execute_approved_purchase`, which verifies the token against the signed draft (hash, amount, currency, payment authorization) and consumes it exactly once. |
| `onResume` | Host's existing `resumeDraft()` (`apps/api/src/muse-agent-host.ts`), which revalidates first and returns `present_review`, `reapproval_required`, or `execution_state`, unchanged. |
| `onReminderOptIn` | Existing `optInToReminder()` (`apps/api/src/muse-reminder.ts`), with the principal only. |
| `onReminderOptOut` | Existing `optOutOfReminder()` with action `'dismiss'`, which kills the pending reminder. |

Production binding, for a host that actually wires this:

- approve: `AuthenticatedMuseCommerceHost.dispatch({action:
  'execute_approved_purchase', args: {draftId}})` on a host
  constructed with the authenticated session's approvalToken
  in its `MuseAgentRequest`;
- resume: `AuthenticatedMuseCommerceHost.resumeDraft(
  {changedSinceReview, now})` on the same host;
- opt-in: `optInToReminder({store, principalSubject,
  principalCompanyId, companyId: principalCompanyId, draftId,
  now})` with the host's reminder store;
- opt-out: `optOutOfReminder({...same, action: 'dismiss',
  now})`.

Until a host actually passes those bound methods, this adapter
is a tested mapping, not live panel-to-API traffic — and that
distinction is stated, not hidden.

## Fail-closed rules

In order, before any dependency call:

1. No authenticated principal (empty subject or companyId) →
   `muse_panel_host_principal_required`.
2. Company acted for differs from the principal's company →
   `provider_readiness_company_mismatch`. Construction itself
   throws on a mismatched company, so a wiring built for the
   wrong company never reaches a handler call.
3. No draftId → `muse_panel_host_draft_required`.
4. Approval without a host-supplied token →
   `approval_token_required`, and the approval dependency is
   never called. A tampered, expired, or changed draft fails
   or reapprovals inside the existing approval flow; this
   adapter never converts a failure into an approval and never
   retries a failure automatically.
5. A second concurrent `onApprove` call returns without
   calling the approval dependency again (the panel already
   disables its button on click; this is the host-side
   equivalent). The guard resets when the first call settles,
   so a failed approval can be retried by an explicit new
   click through the same consume-once flow — never an
   automatic retry.
6. Resume never re-buys: an `execution_state` decision is
   returned unchanged, never turned into a fresh Buy, and no
   execution is performed by this adapter.
7. Reminder opt-in is explicit only: mounting or rendering
   the panel never calls it, the default remains OFF, and the
   reminder itself stays generic and one-only by the reminder
   module's own rules. This adapter adds no content, price,
   seller, or pitch.

## What this change never does

- No public HTTP route is added. A future route, if one is
  ever added, must pass the authenticated principal, or it
  must not exist.
- No draft is signed, no approval is granted by the panel,
  no seller fact is supplied by the panel, and nothing is
  executed by this adapter. The server re-validates every
  callback.
- No live HTTP traffic, no live panel-to-API flow, and no
  native Muse window integration is claimed. A native Muse
  window renderer remains a separate, Meta-approval-gated
  step.
- No live seller, live payment, live Shop handling, live
  catalog read, or live reminder delivery is claimed. The
  reminder channel is still not configured, so no real
  consumer has received a reminder through this wiring.

## Tests

- Full suite: `apps/api/test/muse-panel-host.test.ts`
  (mocked server methods only) — approve routes only with a
  host-supplied token, approve without a token fails closed,
  a tampered/expired/changed approval failure propagates and
  is never converted into an approval, a second concurrent
  approve does not call the approval flow again, resume
  routes to `resumeDraft` and returns the decision unchanged
  (present, reapproval, and execution states), reminder
  opt-in routes with the principal only and opt-out kills
  the pending reminder, tenant mismatch fails closed before
  any call, no-principal handlers are refused, and handlers
  take no arguments (identity comes from wiring, never from
  the panel).
- CI-listed gate: `.github/workflows/ci.yml` was not modified
  in this change, so one wiring gate is also appended to the
  already CI-listed
  `apps/api/test/provider-readiness.test.ts`, which CI runs.
  The full suite should be added to `ci.yml` by a later
  change that is allowed to touch it; until then, the
  standalone file is run locally, not claimed as CI-covered.

See also: `apps/demo/src/muse-feature-panel.ts` (the panel),
`apps/api/src/muse-agent-host.ts` (`resumeDraft`),
`apps/api/src/muse-abandoned-recovery.ts` (resume decisions),
`apps/api/src/muse-reminder.ts` (reminder rules),
`docs/research/accessibility-abandoned-recovery.md` §8 (what remains).
