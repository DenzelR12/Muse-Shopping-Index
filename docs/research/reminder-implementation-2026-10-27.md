# Opt-in reminder — implemented as a gated server component (2026-10-27)

This document describes the reminder implementation added after the
locale-as-code step and before the polish step. It implements
docs/research/accessibility-abandoned-recovery.md §3 ("one reminder, with
consent, and generic") as code. It does **not** claim a live
reminder: with no authorized channel configured in production,
reminders are blocked, and no real consumer has received one.

## What was built

- Code: `apps/api/src/muse-reminder.ts` — an internal helper, not a
  public route. There is deliberately no new public purchase route,
  and no route that accepts a subject or company from a body: a
  future route must pass the authenticated principal, or it must
  not exist.
- Stores: `MemoryMuseReminderStore` (tests and hosts without
  Postgres) and `PostgresMuseReminderStore` (table `muse_reminders`,
  created on first use like `company_seller_manifests`, one row per
  consumer + company + draft).
- Functions: `optInToReminder`, `optOutOfReminder`,
  `sendMuseReminder`, plus the fixed payload constant
  `MUSE_REMINDER_PAYLOAD` and the channel interface
  `MuseReminderChannel`.
- Tests: `apps/api/test/muse-reminder.test.ts` (full suite, mocked
  channel transport only) and fail-closed gates appended to the
  already CI-listed `apps/api/test/provider-readiness.test.ts`.

## Opt-in rule

- Opt-in is explicit only, at the exact review stage. Viewing a
  review, starting an intent, or having a draft is **never**
  opt-in. Approving a purchase is not consent to reminders, and
  asking for a reminder is not approval of a purchase. The
  default is no reminder.
- One record per consumer + company + draft, with status
  `PENDING` → `SENT`, or `OPTED_OUT` / `DISMISSED`. The consumer
  subject and company come from the authenticated principal
  only — never from a request body, a caption, or model text —
  and `companyId` must equal `principal.orgId`, else
  `provider_readiness_company_mismatch`.

## Eligibility, checked before any send, in order

1. Tenant match (draft company and consumer match the principal).
2. An opt-in record exists (`muse_reminder_not_opted_in`).
3. The record is `PENDING` (`muse_reminder_not_pending` — this
   covers already-sent, opted-out, and dismissed).
4. The draft is not approved and not executed
   (`muse_reminder_draft_already_approved`). A reminder is for an
   **unapproved** review only: it never reminds anyone to
   re-approve an already-approved purchase, and never reminds
   after execution.
5. The draft is not expired (`muse_reminder_draft_expired`).
6. A channel is registered (`muse_reminder_channel_not_
   registered`).

Any failed check throws, nothing is sent, and no approval is
consumed. A channel send that throws leaves the record
`PENDING` — a failed send is never recorded as `SENT`.

## Generic content, by construction

The payload is a single fixed constant:

> "Your review is waiting in Muse. Open Muse to return to your
> review."

It contains no price, no seller or product claim, no draft
terms, no approval token, no raw provider ID, and no buy pitch
— the payload type has no field where such a value could even
be put, and the test suite asserts the exact payload and
forbids price/title/token/ID strings in it. A reminder that
contained a price would be an out-of-date review, and a message
is not an exact review. The reminder authorises nothing:
opening Muse must revalidate the draft first (expired/changed
→ a new draft, a new review with a diff, and a fresh
approval; an old unapproved review is never carried over).
That revalidation lives in the draft service, not here.

## Sending, fail-closed

Sending goes only through a `MuseReminderChannel` supplied by
the caller — an interface registered at server startup by the
operator, never over HTTP, never from a request body, following
the Shop Pay / live-ads / generic-adapter gate pattern. This
module calls no email or SMS API directly and uses no channel
credentials. With no channel configured, sending is provably
blocked in tests.

## One reminder only, and the opt-out / re-opt-in rule

After a successful send the record becomes `SENT`
(`sentCount: 1`) and any second send for the same draft is
refused. Opt-out and dismiss are single authenticated actions
that move a `PENDING` record to `OPTED_OUT` / `DISMISSED` and
permanently kill that pending reminder — it never auto-revives.

The design doc's two sentences — "opt-out permanently prevents
that draft's reminder" and "a later re-opt-in is allowed" —
are reconciled in code as: a fresh explicit re-opt-in may
create a new `PENDING` record **only if no reminder has ever
been sent for that draft** (`sentCount` is still 0) and, when
draft state is supplied, only while the draft is still
unapproved and unexpired. After a reminder has been sent, no
re-opt-in can create another one. Reminder loops are therefore
impossible by construction. (The send-time eligibility gate is
the backstop even when draft state is not supplied at opt-in:
an approved or expired draft can never actually be sent to,
whatever the record says.)

## Privacy and retention

Records are keyed by consumer + company + draft, never shared
across companies or consumers, never fed into ads or
retargeting, and never read back to anyone except the owning
consumer's own authenticated flow. A record is retained only
for its draft's expiry window: once the draft has expired, the
record is dead (it can never send) and is eligible for
deletion. No retention job is implemented in this change; the
deletion itself is a separate operational step.

## Explicitly NOT implemented, and NOT claimed

- **No live reminder.** No authorized channel is configured in
  production, so `sendMuseReminder` with no channel is blocked
  by design. No real consumer has received a reminder from
  this module, and no live sending is claimed.
- **Consumer-facing opt-in entry now exists — in the Muse
  feature panel, not a storefront.** Since the
  abandoned-chat recovery change, the panel
  (`apps/demo/src/muse-feature-panel.ts`) renders an
  explicit "Remind me" checkbox at review stage, default
  OFF and never pre-checked, which calls the host's
  opt-in handler (which calls `optInToReminder` with the
  authenticated principal only), plus a one-tap dismiss
  for a pending reminder. What still does not exist is a
  live channel: until an authorized channel is configured,
  opting in records intent and sending stays blocked by
  design — which is itself fail-closed.
- **No dark patterns.** No countdown, no fake stock, no
  discount lure, no repeated nudges, no model-written
  persuasion text. The text is a fixed, reviewed constant.
- The step-2 doc's other "code needed" items — a real-text
  review renderer, announced status changes, a pre-expiry
  warning, and the production resume-by-draft entry path —
  are now also code, in the Muse feature panel, the host
  `resumeDraft()` path, and `apps/api/src/muse-abandoned-recovery.ts`
  (see docs/research/accessibility-abandoned-recovery.md §8). What
  remains is the native Muse window renderer and a live
  reminder channel.
- No model was trained or fine-tuned by this change, and no
  live Meta, Shop, payment, or catalog claim is made by it.
