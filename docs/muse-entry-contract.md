# Muse Shopping Index — Muse/Meta entry contract

Status: entry contract, not a live claim. This document defines our
side of the aim and names the Meta side honestly. It does not claim
any Meta approval, distribution, button, callback, or deep link has
been obtained, and it invents no Meta API, deep-link scheme, or Muse
app URL.

## The aim, in one sentence

Pressing "Shop this reel" on Meta opens a Muse window to complete
the purchase: exact review → one explicit approval → server
execution → owned status.

## The complete chain, in order

```
1. Meta button press
     "Shop this reel" on a Reel (Meta surface)
2. Signed handoff (Meta side, still needed — see below)
     reelId, business, product hints, signature
3. POST /v1/muse/reel-entry (our side, in code)
     Normalizes the signature-verified intent ONLY.
     Creates nothing: no draft, no approval, no execution, no state.
4. Authenticated company draft service (our side, in code)
     Creates or looks up an OWNED signed draft for that intent:
     resolved seller display name, resolved item titles, quantity,
     price, shipping, tax, total, currency, terms, payment timing,
     full ship-to, exact draft hash, expiry.
5. POST /v1/muse/agent (our side, in code)
     Starts ONLY from that existing owned signed draft.
     Model proposes tools; deterministic server code authorizes.
6. Exact review in the Muse window (our side, in code)
     Seller, offering + exact configuration, quantity, ship-to,
     shipping and other fees, tax, total + currency, payment timing,
     refund/cancellation terms, payment method as "Saved payment"
     (or "Shop Pay · Saved payment" for the shop_pay vehicle).
     Consumer text uses safe labels only — never raw provider names,
     connected-account IDs, credentials, or webhook internals.
7. One explicit human approval (our side, in code)
     Bound to the exact draft hash, total, currency, and saved
     payment authorization. Consumed once. Never issued to a model
     prompt, never granted by model text.
8. Server execution (our side, in code)
     Live provider state revalidated before execution; provider
     idempotency preserved; payment/order state verified, not assumed.
9. Owned status (our side, in code)
     GET /v1/muse/orders/:draftId, buyer from verified identity.
     A retrieved order/tracking record does not prove delivery;
     bookings, services, digital, and pickup use their own
     completion evidence.
```

## The reel-entry gate, exactly as implemented

`POST /v1/muse/reel-entry` (`apps/api/src/index.ts`,
`validateReelEntry` in `apps/api/src/live-activation.ts`):

- Requires `META_REEL_CALLBACK_SIGNING_SECRET`. No secret → **410**
  (`reel_entry_not_configured`). The route is disabled, not degraded.
- Requires a valid signature header, `sha256=<hex>`, an HMAC-SHA256
  over the raw request body, compared in constant time. Bad or
  missing signature → **401** (`reel_entry_signature_invalid`).
- On success it returns only a normalized intent:
  `{reelId, companyId, offerId, receivedAt}` — plus the note
  `reel_intent_received_no_draft_no_approval_no_execution`.
- It never creates a draft, never signs anything, never issues
  approval, never executes, and never changes state. Any caller that
  treats a reel-entry response as a draft, an approval, or a
  purchase is misusing it.

The same gate pattern already guards Meta verification recording
(`META_VERIFICATION_WEBHOOK_SECRET`, `x-meta-verification-signature`,
410 without the secret, 401 on a bad signature).

## What can NEVER grant approval, sign a draft, or supply display facts

This is the non-negotiable boundary, and it applies at every step
of the chain, including the button press itself:

- **Unsigned intent** — no signature, no entry. An unsigned deep
  link, query string, or browser field must never start a purchase.
- **Caption text** — captions are untrusted data. A caption may
  suggest an intent; it may never supply a seller name, a title, or
  a price. Display facts come only from the server-registered
  manifest / verified catalog, via the authenticated company caller.
- **Model text** — the model proposes tools. It cannot grant
  identity, permission, approval, payment authority, or success.
  Model prose saying "approved" or "bought" is not approval.
- **A browser field** — nothing parsed from browser JSON,
  localStorage, or a query string is a signed envelope. The
  confirmation page renders only from a server-supplied signed
  approval envelope, and fails closed on a raw-ID display value.
- **The demo bridge / simulator** — `apps/demo/src/reel-demo-bridge.ts`
  and `apps/demo/src/muse-entry-simulator.ts` are labelled
  demonstration harnesses. They prepare a plan and a review preview;
  they sign nothing, approve nothing, and execute nothing.

Fail-closed consequences, all in code:

- Changed price, tax, shipping, configuration, terms, or payment
  authorization since review → `request_reapproval`. No silent
  re-execution on changed terms.
- Expired approval, or a hash / authorization mismatch → 
  `request_reapproval`.
- Uncertain external completion → `RECONCILE_REQUIRED` →
  `escalate_reconciliation`. Never re-execute after a timeout,
  ambiguous response, webhook delay, or payment success.
- Auth-required payment fallback → `PAYMENT_FALLBACK_PENDING` →
  trusted Stripe Checkout only.
- Refund → `REFUND_REQUIRED` → `REFUND_EXECUTING` →
  `REFUND_SUBMITTED` → `REFUNDED`; submitted is not verified
  refunded, and a failed refund restores `REFUND_REQUIRED`.
- Raw-ID seller, title, or display value → fail closed
  (`muse_review_seller_display_required`,
  `muse_confirmation_unsafe_display`, and the demo handoff errors),
  never a raw-ID fallback in the review.

## What our side already provides, ready for Meta

- The signed-intent entry route above (credential-gated, fail-closed).
- The authenticated company draft service, seller manifest store,
  and handoff preflight (`validateReelDemoBridgeDraftHandoff`):
  non-FINAL_REVIEW, demo label, raw-ID display name/title, or
  title mismatch fail fast before any draft submission.
- The agent host starting only from an owned signed draft, with
  exact-review dispatch and a WAITING stop (explicit human Buy).
- The live confirmation page (`mountMuseConfirmationPage`) and Buy
  guard: one button, disabled on click, second in-flight click
  ignored, resume by draft ID without a new approval, reconcile
  without retry, drift/expiry/unknown → reapproval.
- The demo entry simulator
  (`apps/demo/src/muse-entry-simulator.ts`): a "Shop this reel"
  button in the demo that simulates the Meta press through the
  existing demo bridge, then shows the exact-review preview.
  Labelled everywhere as DEMO SIMULATOR — NOT a native Meta
  button, NOT Meta distribution, NOT a Meta callback. Its
  `signatureVerified` flag is a caller-supplied simulation input,
  not an HMAC verification, and must never be used as an auth gate.

## What Meta must still provide — NOT claimed, NOT obtained

Until each of these exists, the chain above is complete on our
side and open on Meta's side, and any presentation must say so:

1. **Reels distribution approval** — permission for a "Shop this
   reel" action on Reels to hand off to this agent, rather than to
   a website or a shop. No distribution approval is claimed.
2. **A signed callback / deep-link contract** — the exact format
   Meta will send on a button press (fields, signing secret, header
   name, replay protection) and the exact destination it resolves
   to. This repo deliberately invents none of these: a guessed
   contract would fail, or worse appear to succeed, against the
   real surface. The reel-entry route is ready to accept a signed
   callback once Meta defines it; it does not define it.
3. **Business verification** — each business whose Reel it is must
   be Meta-verified, recorded through the existing verification
   gate (evidence rules: no self-attestation, no placeholder, no
   future or expired evidence), not asserted by the business itself.
4. **Catalog connection** — that business's catalog must be
   connected and verified before catalog data can feed a draft or
   a review (see `docs/indie-submission-brief.md` §2: no Meta
   catalog connection exists today; the integration plan there is
   new work, in order, not done).

Also still open, on our side, and not hidden by this contract:
a fresh Render Postgres (`DATABASE_URL`, card step), remaining
environment variables, one real company end to end in test mode,
a measured clicks/time number, and a 90-second demo video with a
failure/reapproval case. Real money only with explicit approval of
that exact transaction, never automatic after any step above.

## How to test the aim without Meta

1. Press the demo simulator's "Shop this reel" button with a
   verified-signature simulation input → exact-review preview,
   draft signed:false, approvalToken:null.
2. Press it unsigned → rejected (`muse_entry_simulator_signature_required`),
   mirroring the real 401/410 gate. No window, no draft, no approval.
3. Press it with missing details → COLLECT_BATCH, one batch of
   missing fields, no window, no draft, no approval.
4. Press it with a demo-label or raw-ID seller/title → rejected
   before any draft step.
5. In the live path, replace step 1 with a real signed Meta
   callback to `POST /v1/muse/reel-entry` once Meta defines it,
   then follow steps 4–9 above unchanged. Nothing in the
   transaction core changes when the entry point becomes native;
   only the entry point does.

See also: `docs/indie-submission-brief.md` (track, catalogs,
surface framing, failure cases, privacy, why Muse),
`docs/live-readiness.md` (credential-gated live activation points),
`docs/demo-walkthrough.md` (no-money demo),
`docs/render-deployment.md` (live Render deployment status).
