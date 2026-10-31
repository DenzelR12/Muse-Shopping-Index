# First live Stripe TEST-MODE end-to-end order — proof

**Date verified:** 2026-10-31 (completed run ~23:01–23:02 UTC;
completion proven by reconciliation at 2026-10-31T23:06:00.358Z)
**Method:** operator harness (`apps/api/test/muse-live-test-order.ts`)
run in the Render web shell of the production service
(`muse-shopping-index-api`), executing through the server's own
ZeroTrust runtime, the Stripe test-mode adapter
(`apps/api/src/muse-stripe-test-adapter.ts`), and the Postgres
exactly-once store on the live Render database. Stripe **TEST
mode only** throughout.
**Tenant:** ClutchAgent (TEST tenant, Muse Meta side)
**Item:** "Test - ClutchAgent Access" — ClutchAgent Test Catalog
(Meta catalog, TEST), $1.00 USD unit price, read live through the
repo's Meta catalog client in the same run.
**Completed run:** quantity 2 — total **$2.00 USD** — draft
`stripe-test-ee56dfb590db6388e0781192` — Stripe test PaymentIntent
**`pi_3UWlIIRpBKp6rdcR1PVEwkHf`** (TEST mode), status CONFIRMED.
**Secrets:** none appear in this document. The Stripe test key,
catalog token, and signing secrets are reported by presence only;
operator approval codes are reported by SHA-256 fingerprint only.
No real money moved at any point in this document: every charge
described is a Stripe test-mode PaymentIntent confirmed with
Stripe's test card.

## What ran

One unbroken chain, each step timestamped by the harness:

1. **Live catalog read** — the repo's read-only Meta catalog
   client read the ClutchAgent Test Catalog live and returned the
   verified TEST item ($1.00 USD, in stock).
2. **Signed draft** — built server-side from that verified read
   only (quantity 2 → total $2.00 USD), signed with the draft
   signing secret.
3. **Explicit approval** — an operator approval token issued for
   that exact draft after the user's explicit approval of the
   exact $2.00 quantity-2 transaction (approved 2026-10-31
   18:51 EDT as its own transaction).
4. **Exactly-once claim** — won once under the claim key
   `gift-signal:test-order:clutchagent:stripe-test-ee56dfb590db6388e0781192`
   (the `gift-signal:` prefix is the existing operator contract and
   is never renamed), stored in Postgres on the live database.
5. **Execution** — the Stripe test-mode adapter created and
   confirmed a test PaymentIntent for exactly the draft's amount
   and currency, with the same key as the Stripe idempotency key.
6. **Provider result** — PaymentIntent
   `pi_3UWlIIRpBKp6rdcR1PVEwkHf`, CONFIRMED (proven by
   reconciliation; see the timeline).

## Timeline — including the failures

All times UTC, 2026-10-31, from the harness's own timestamped
reports. The path to the completed order ran through three
fail-closed stops and two failed executions; each is recorded
because each one demonstrates a gate doing its job.

| When | Step | Result |
| --- | --- | --- |
| ~21:35 | Gate check, first attempt | **CONFIG_GATING, exit 2** — `muse_stripe_test_live_key_refused`: the key first pasted into Render was a **live** key; the adapter refused it in production and nothing executed. The user replaced it with the `sk_test_` test key. |
| ~21:41 | Gate check, second attempt | **CONFIG_GATING, exit 2** — `test_order_signing_secrets_not_configured`: `DRAFT_SIGNING_SECRET` / `APPROVAL_SIGNING_SECRET` had never been set in Render. The user added both (self-generated values, never in chat or repo); nothing executed. |
| 21:48:34.794 | Catalog read (quantity-1 draft) | PASS — "Test - ClutchAgent Access", 1 USD, verified live |
| 21:48:35.077 | Draft built + approval gate | Draft `stripe-test-03965b9b155b28bee08048a4`, total 1 USD; **AWAITING_APPROVAL, exit 3** — no approval code set, nothing executed |
| 21:54:43.848 | Approved run #1 — catalog read | PASS |
| 21:54:44.153 | Draft + approval gate | PASS — approval token issued for the exact draft (code fingerprint `1d006905de6e`) |
| 21:54:44.154 | Exactly-once claim | WON |
| 21:54:44.186 | Execution | **FAILED — Stripe http_400**, no PaymentIntent created, no charge. Stripe's own email to the account named the cause: the confirm call lacked the `return_url` parameter Stripe requires. |
| — | Fix (commit `65b6df4`, CI green, 52/52 tests) | Adapter sends `return_url`; exactly-once store + harness gain an **evidence-gated release** for completed definite failures |
| 22:09:25.602 | Release run #1 | Catalog + draft PASS; claim evidence PASS (stored claim completed, result FAILED, no provider reference); Stripe evidence PASS (**0 PaymentIntents** exist for the draft) |
| 22:09:26.128 | Claim released | **CLAIM_RELEASED, exit 0** — the release path's first live run |
| 22:11:14.903 | Corrected run — catalog read | PASS |
| 22:11:15.218 | Claim won; execution | **FAILED again — bare http_400**, no PaymentIntent. The adapter discarded Stripe's error body, so the report carried only the status code. |
| — | Fix (commit `a45ed5d`, CI green, 53/53 tests) | Adapter now surfaces Stripe's error type, param, and message (on `invalid_request_error` the `code` field is usually absent — `message`/`param`/`type` carry the diagnosis) |
| 22:40:22.129 | Release run #2 | Both evidence checks PASS again |
| 22:40:22.602 | Claim released | **CLAIM_RELEASED, exit 0** |
| 22:42:16.984 | Diagnostic run — catalog read | PASS |
| 22:42:17.414 | Execution | **FAILED — `idempotency_error`**, in Stripe's words: keys can only be reused with the same parameters they were first used with. Diagnosis confirmed: the quantity-1 draft's Stripe idempotency key was burned by the first, pre-`return_url` attempt (21:54:44) and stays burned until Stripe prunes the key ~24 hours later (~2026-11-01T21:54Z). |
| — | Quantity support (commit `b61f423`, CI green, 53/53 tests) | Harness gains `MUSE_TEST_ORDER_QUANTITY` (1..99, default 1). Quantity is part of draft identity, so quantity 2 is a genuinely different draft with its own claim and idempotency key — approved by the user as its own exact $2.00 transaction rather than manufactured to dodge the burned key (no key renaming, no parameter-hash versioning). |
| 23:01:01.977 | Quantity-2 gate check — catalog read | PASS — "Test - ClutchAgent Access", 1 USD |
| 23:01:02.318 | Draft built + approval gate | Draft `stripe-test-ee56dfb590db6388e0781192` — quantity 2 — total 2 USD; **AWAITING_APPROVAL, exit 3**, nothing executed |
| ~23:01–23:02 | Approved quantity-2 run | Executed once with a fresh one-time approval code. Mid-run, an unrelated repo commit (the user's pitch-video rename) redeployed the API and killed the shell instance before the run's output was captured — **outcome unknown at capture time, and the run was NOT blindly retried**. |
| 23:06:00.358 | **Reconciliation** | Stored claim read back from Postgres: **completed, result CONFIRMED, provider reference `pi_3UWlIIRpBKp6rdcR1PVEwkHf`** (Stripe TEST mode). The order had completed. In the same pass, the release guard correctly **REFUSED** to release this claim — it only releases definite failures, never a confirmed result. Do not re-run the quantity-2 draft: it is completed. |

## Safety properties demonstrated live

- **Live keys are refused in production.** The adapter accepts
  `sk_test_` keys only (checked at construction, registration,
  and execution); a live key pasted by mistake was refused with
  nothing executed — the first gate check of the day.
- **Config gates fail closed.** Missing signing secrets stopped
  the run before any catalog read or draft; missing approval
  stopped it after the draft, twice (quantity 1 and quantity 2),
  with nothing executed either time.
- **Approval is bound to the exact draft.** The approval token is
  issued only for the signed draft's id, hash, amount, and
  currency; the amount executed came only from the verified
  catalog read (unit price × approved quantity), never from the
  caller.
- **Exactly-once is real, in Postgres.** One claim per draft;
  the claim, its completion, and the confirmed result survived a
  mid-run redeploy that killed the executing shell — which is
  what made reconciliation instead of a retry possible.
- **Uncertainty reconciles, never retries.** When the completed
  run's outcome was unknown, nobody re-ran it. The stored claim
  was read back and carried the provider reference.
- **Release requires evidence, twice over.** A completed FAILED
  claim was released only when (a) the stored result was FAILED
  with no provider reference and (b) Stripe itself showed zero
  PaymentIntents for the draft — and the same guard refused to
  release the CONFIRMED claim.
- **One draft, one key — even when it hurts.** The burned
  quantity-1 key was not renamed, versioned, or dodged. The
  quantity-2 order stands as its own approved transaction, and
  this document says so.

## What this proves

- The full server chain works live, end to end, against real
  provider systems in test mode: live Meta catalog read → signed
  draft → explicit approval → Postgres exactly-once claim →
  Stripe test PaymentIntent confirmed, with the result stored
  and reconcilable.
- The fail-closed gates around that chain (test-key-only
  adapter, config gating, approval gate, evidence-gated release,
  reconciliation-on-uncertainty) all fired correctly under real
  conditions, including two genuine provider failures.

## What this does NOT prove

- **Not a live seller, not live payment, no real money.** The
  item is a labelled TEST item at a test price in a TEST catalog;
  the charge is a Stripe test-mode PaymentIntent on a test card.
  Stripe live mode remains gated on explicit approval of an
  exact live transaction, which has not been given or run.
- **Not a panel or Muse-host run.** Execution ran through the
  operator harness against the production service's runtime code
  and live Postgres — not through a consumer panel session.
  Production host binding remains the one open panel gap, and
  `MUSE_AGENT_ENABLED` stayed false throughout.
- **Not Shop Pay, not Shopify, no shipment.** No THEENRG order
  ran (no Shopify store exists yet); ClutchAgent's outcome is
  service access, not a delivery. No order, tracking, or carrier
  fact is claimed.
- **The quantity-1 ($1.00) draft has not completed.** Its Stripe
  idempotency key is burned until ~2026-11-01T21:54Z; running it
  after the prune is optional — this proof does not depend on it.
- **A single measured run, not a load test.** No concurrency,
  latency, or scale claim is made from it.
