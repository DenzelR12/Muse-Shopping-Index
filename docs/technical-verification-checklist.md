# Technical verification checklist — Muse Shopping Index

## Limits — read first

- **Checklist only, not results.** Every step below is currently
  unchecked for a live run. A step is checked only when the evidence
  in its "Evidence that counts" column is recorded, with a date and
  the exact run conditions. A step is never checked on the basis of a
  mocked test, a local demo, or a CI run alone — those are code
  evidence, and they are labelled as such where they exist.
- **Live-blocked steps are listed, not hidden.** Steps 1, 3, 4, and 5
  are blocked on items only the user (or an external approver) can
  supply: a Render card + database, a store owner's authorization,
  and a Meta test catalog. Those blockers are stated in each step.
- **Muse feature, not a storefront.** The panel verified in step 2 is
  a Muse feature panel mounted by a Muse host inside a Muse window /
  surface. Verification never involves a shop site, cart page,
  checkout page, or product-listing page.

## Step 1 — Real Postgres verification (BLOCKED: user-only card + DB)

| Item | Detail |
| --- | --- |
| Blocked on | User adds a card in Render (temporary $1 authorization, not a charge), creates `muse-shopping-index-db` at the approved $10.50/mo config (PostgreSQL 18, Oregon, $6 compute + 15 GB $4.50), and links `DATABASE_URL`. No database exists yet, and no card is stored in Render, the Vault, memory, or any file. |
| What to check | Render service root no longer returns `persistent_rate_limit_not_configured`; health/readiness endpoints respond with persistence configured; a signed draft, a reminder record, and a BI event persist across a service restart (Free-plan spin-down does not lose them). |
| Evidence that counts | A recorded root response + health/readiness response from the deployed service, with the deployed commit, plus a persist-and-restart test record. |
| What would NOT count | A local Postgres run (already done, 2026-10-26, local Postgres 16 — code evidence, not live evidence), a CI run, or a root response from a service without a database. |

## Step 2 — Real-browser confirmation run

| Item | Detail |
| --- | --- |
| What to check | In a real browser, with a real DOM (not a test stub): the Muse feature panel renders the exact review in reading order; approve disables on click and a second click is ignored; resume after closing returns the same draft after revalidation; a changed price shows a diff in words and requires fresh approval; an approved/executing draft shows execution state, never a fresh Buy; a reminder opt-in is OFF by default and dismiss works in one tap; announced status fires once per change. |
| Evidence that counts | A recorded run with browser, panel state at each step, and the server's response for each step (approval consumed once, resume decision, reapproval decision). Screenshots, if any, must contain no tokens, approval tokens, raw IDs, or secrets. |
| What would NOT count | The panel tests' minimal in-repo DOM stub (code evidence, documented in the panel test), a demo video, or a mock-host run. |

## Step 3 — Live Shopify read (BLOCKED: store-owner call pending)

| Item | Detail |
| --- | --- |
| Blocked on | A store-owner call later 2026-10-27, and the owner's authorization (custom app, read-only first, token to secret manager / Render only). No store, token, or seller is verified yet. |
| What to check | One agreed test product, via the Storefront read-only adapter (`apps/api/src/shopify-catalog.ts`): title, price, currency, and stock match the agreed test product; freshness within 24 hours; raw IDs stripped from output; output labelled SHOPIFY / TEST; tenant is that company only. |
| Evidence that counts | A recorded read result (title/price/currency/stock only, IDs stripped, TEST label) with the store type (development vs live) and the agreed test product. The token value is never recorded. |
| What would NOT count | A mocked test, a Partner account screenshot, a development store existing without a read, or a read against a store the owner has not authorized. |

## Step 4 — Live Meta catalog read (BLOCKED: test catalog not verified)

| Item | Detail |
| --- | --- |
| Blocked on | System User, token, and test catalog for the `muse shop index` Meta app are not separately verified as done. The app exists and its Catalog API use case is Ready for testing; the token name only is present in Render; the catalog ID is not verified; API Calls were 0 at the last screenshot. |
| What to check | One test catalog, via the read-only Meta catalog client (`apps/api/src/meta-catalog.ts`, GET only, Graph API v26.0): title, price, currency, and stock match the test catalog entry; freshness within 24 hours; raw IDs stripped; output labelled META CATALOG / TEST; tenant is that company only. The node/products edge shape, which is not live-verified, must be confirmed against the real response, not assumed. |
| Evidence that counts | A recorded read result (title/price/currency/stock only, IDs stripped, TEST label) with the catalog's test status. The token value is never recorded. |
| What would NOT count | A mocked test, a "Ready for testing" use-case screenshot, a token name in an environment list, or a read against another merchant's catalog (which standard access for own assets does not authorize). |

## Step 5 — End-to-end test order (BLOCKED: steps 1, 3, and a test approval)

| Item | Detail |
| --- | --- |
| What to check | In test mode only: one test product, exact review, one approval, server execution, verified order state, and a reconciliation check on an uncertain completion (uncertain → RECONCILE_REQUIRED, escalated, never re-executed, never a second charge). On a development store, a Bogus/test payment only; never a real card for a pilot test. |
| Evidence that counts | A recorded run with all three timestamps (tap → approval, approval → verified order, verified order → delivered or test-delivery confirmation), the verified order state, and the reconciliation case result. Real money only with explicit approval of that exact transaction — never automatic after this step. |
| What would NOT count | A demo run, a submitted-but-unverified order, a "processing" state presented as an order, or a test order on a live store with a real card. |

## Step 6 — Latency measurement

| Item | Detail |
| --- | --- |
| What to check | Tap → review, review → approval, and approval → verified order, measured on the live test run (step 5) and on the real-browser run (step 2), reported as a distribution (not a single average) and split by path (first request after a Free-plan spin-down vs a warm request). |
| Evidence that counts | Recorded timestamps from the same runs as steps 2 and 5, with the hosting plan and spin-down state noted. A Free-plan first-request delay of 50+ seconds is a hosting artifact, reported as such, never folded into product time or hidden. |
| What would NOT count | Localhost timings presented as live timings, a single run presented as a distribution, or a time that merges chat time with seller/carrier time. |

## Step 7 — Adversarial evidence summary (code evidence, already recorded)

This step is not a live step. It summarizes test coverage that already
exists, so a reviewer can see what is code-verified and what is not.
Counts below are the counts actually run locally in this batch for
the new modules; earlier modules' counts are as recorded in their own
batch reports and are not re-claimed here (see the final batch report
for the exact local counts and the standing caveats).

| Area | Code evidence (not live evidence) |
| --- | --- |
| Panel routes (this batch) | `apps/api/test/muse-panel-routes.test.ts`: fail-closed principal/tenant/draft checks, token-missing 403, failed-approval 422 without retry, resume decision unchanged, reminder delegation with no price/title/token field. Plus one provider-readiness gate (first run in CI — see caveat below). |
| Multimodal intent (this batch) | `apps/demo/test/muse-multimodal-intent.test.ts`: catalog match eligible, caption-vs-catalog drift, no-catalog unverifiable, image-only without catalog unverifiable, stale/unavailable/title-mismatch unverifiable, raw-ID stripping, matching-price not drift. Runs via the demo package test script in CI. |
| Existing coverage (prior batches, not re-run here) | Panel DOM (real-text order, raw-ID rejection, diff in words, aria-live, pre-expiry, buy guard), abandoned resume (principal-only, reapproval, execution state), panel host wiring (token-required approval, resume delegation, tenant mismatch), Meta catalog gates, Shopify catalog gates, reminder gates, locale gate. Full standalone files are not all named in `.github/workflows/ci.yml`; CI-listed gates are the CI-verified subset, and demo-package-script files are covered via that script. |

Standing caveats for every count in this document:

- CI-listed gates vs standalone files: a CI green run covers the
  CI-listed gates, not every standalone test file that is not named
  in `ci.yml`. A standalone file's local pass is not a CI pass.
- No pnpm or Docker in this VM: local runs here used the repo's
  existing Node toolchain (exact versions in the final batch report),
  not a full `pnpm build` / `pnpm test`. A local pass is not a full
  suite pass.
- Provider-readiness gates need a full build (`../dist/...` imports
  in that file): they were not executed locally in this batch and
  their first run is CI, as in prior batches. They must not be
  reported as locally passed.
