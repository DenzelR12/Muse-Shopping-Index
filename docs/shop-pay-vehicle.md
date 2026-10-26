# Shop Pay as an additional payment vehicle

Status: approval/envelope + readiness gating implemented; live Shop Pay
execution is BLOCKED. No live Shop Pay, live Meta, or live payment claim
is made by this document.

## What changed

Shop Pay is an ADDITIONAL payment vehicle alongside Stripe saved
authorization, not a replacement and not a relabel of Stripe:

- Stripe saved authorization (`off_session`, `services/payments/src/stripe.ts`)
  is unchanged and remains the working payment rail.
- Shop identity (Shop OIDC / `shopUserPublicId`) remains the consumer
  enrollment anchor, as before.
- A draft/approval envelope now carries `paymentVehicle: 'stripe' |
  'shop_pay'`, defaulting to `'stripe'` for existing/legacy drafts
  (see `apps/api/src/shop-pay-vehicle.ts` and
  `apps/api/src/provider-transaction-draft.ts`). The vehicle must agree
  with `payment.provider` whenever both are present; a mismatch is
  invalid signed state, never silently coerced to Stripe.
- A Shop Pay saved-authorization path reuses the exact Stripe approval
  binding: draft hash, total, currency, payment-authorization
  reference, consume-once JTI, drift revalidation (live landed totals
  must match the approved draft or the submit fails with
  `provider_checkout_reapproval_required`), and reconciliation on
  uncertainty (no blind retry). See
  `apps/api/src/muse-confirmation-submit.ts` and
  `apps/api/src/consumer-commerce-identity.ts`
  (`shopPaySavedPaymentAuthorization` /
  `resolveShopPaySavedPayment`).
- Consumer-facing label: exactly `Saved payment` for Stripe, and
  `Shop Pay · Saved payment` ONLY when the vehicle is actually
  `shop_pay`. Raw provider/account IDs are never rendered
  (`apps/api/src/muse-agent-host.ts` review event,
  `apps/storefront/src/muse-confirmation.ts` sheet).

## Readiness gating

A Shop Pay vehicle is ready only when BOTH hold
(`shop-pay-vehicle.ts`: `isShopPayVehicleReady` /
`assertShopPayVehicleReady`):

1. The company is transaction-ready under the Step 2 rules:
   `TRANSACTION_READY` or `AUTONOMOUS_READY` on the
   `CONNECTED → META_VERIFIED → CATALOG_VERIFIED → TRANSACTION_READY →
   AUTONOMOUS_READY` ladder. Meta-origin businesses still need
   validated Meta verification evidence, and an omitted/unknown origin
   still fails closed to the Meta path in
   `providerReadiness.evaluate()` — the two call sites in
   `apps/api/src/index.ts` pass no origin, and that behaviour is
   intentionally left intact.
2. The server-supplied Shop Pay vehicle flag for the company is true.
   It is never read from model output, browser JSON, or a
   consumer-supplied field.

The host (`muse-agent-host.ts`) additionally fails a `shop_pay` draft
closed on business readiness when no server-supplied vehicle flag is
available. Stripe drafts never consult that flag.

## What remains blocked, and why

Live Shop Pay execution is blocked with the named error
`shop_pay_execution_blocked`:

- A codebase search before this step found NO Shop Pay API client, NO
  authorized Shop Pay credentials, and NO Shop Pay checkout endpoint
  in code. `services/payments` contains only a Stripe client.
- `executeShopPaySavedAuthorization()` in `shop-pay-vehicle.ts` always
  throws that error. It is called in `submitMuseConfirmation` AFTER
  drift revalidation and AFTER exact approval verification, but
  BEFORE the execution service — so a blocked attempt does not consume
  the one-time approval JTI and commits no intent or payment.
- `ProviderTransactionExecutionService.createCheckout` repeats the
  same block defensively for direct callers, before any
  connection/policy/intent lookup or approval consumption.
- No Shop Pay API call, fake credential, or fake success path was
  invented. Unblocking live execution requires, at minimum: authorized
  Shop Pay credentials through an approved connection, a real Shop Pay
  checkout client, and wiring that keeps the exact approval binding,
  consume-once JTI, drift revalidation, and reconciliation behaviour
  of the Stripe path.

The company API route `/v1/provider-checkout/:provider/:account`
remains Stripe-only (other providers return `unknown_provider`); the
Muse confirmation path is where a `shop_pay` draft reaches the named
blocked error. Repo tests and CI runs are NOT claimed here — see the
test files listed below for the coverage that was added.

## Tests (appended to existing, CI-listed test files)

- `apps/api/test/provider-transaction-draft.test.ts` — Stripe default
  unchanged, `shop_pay` envelope round-trip, vehicle/provider
  mismatch rejected.
- `apps/api/test/consumer-commerce-identity.test.ts` — Shop Pay saved
  authorization resolver (Stripe resolver still returns null for a
  `shop_pay` identity and vice versa).
- `apps/api/test/muse-confirmation-submit.test.ts` — `shop_pay` drift
  → reapproval, approval/reference mismatch → rejection, valid
  `shop_pay` attempt → `shop_pay_execution_blocked` with no execution
  call and no approval consumption, not-ready vehicle →
  `shop_pay_vehicle_not_ready`.
- `apps/api/test/provider-transaction-execution.test.ts` — direct
  `shop_pay` execution → `shop_pay_execution_blocked` before any
  intent/consume.
- `apps/api/test/muse-agent-host.test.ts` — `shop_pay` review label
  `Shop Pay · Saved payment` with no raw IDs, and business-ready
  false without a vehicle flag.
- `apps/storefront/src/muse-confirmation.test.ts` — `shop_pay` sheet
  label, Stripe sheet unchanged, vehicle/provider mismatch rejected.
- `apps/api/src/shop-pay-vehicle.ts` is covered through the above;
  its readiness function is exercised via the submit/host tests.
  No new test file was added, so no workflow edit is needed for CI
  to run these tests (the workflow file was not touched).
