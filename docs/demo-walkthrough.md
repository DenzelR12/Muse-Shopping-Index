# No-Money Demo Walkthrough — Muse Shopping Index

**DEMO ONLY. Not a live Shop integration, not native Meta/Reels entry,
not account linking, not a live payment, and not live shipping.**

- Target repo: `DenzelR12/Muse-Shopping-Index`, main
- Walkthrough verified against HEAD `f4bb66221fa52198cc52ee8395e83609cc17a7d1`
- CI for that HEAD: `ci` #39, Success (public run/job status + step
  checkmarks; detailed logs require sign-in and were not inspected).
  That CI result proves typecheck, build, and the CI-listed tests pass.
  It does **not** prove a live server, live payment, or live Shop effect.

## What the demo proves, and what it does not

Proves, with mocked/offline transports or supplied demo events only:

- Reel intent → one batch of missing details → one exact review preview
- Signed draft → approval envelope → host review → storefront sheet
- Live confirmation page with a guarded Buy button and owned-status
  resume on reconnect
- Offline rehearsal with mocked transports
- Read-only BI reporting over supplied demo events, with verification
  gates, tenant trimming, and a 30-day attribution rule

Does NOT prove, and must never be presented as proving:

- Native Meta/Reels distribution, a native Instagram "Shop this reel"
  button, or Meta approval of distribution
- Live Shop handling of notifications, verification, email, or shipping
  for any real merchant
- A real payment, a real order, a real shipment, or a live Shop Pay
  execution (Shop Pay execution is blocked by design:
  `shop_pay_execution_blocked`)
- Live Meta ad ingestion (BI is supplied/demo events only)
- Real Postgres behaviour (manifest/BI stores were tested with a
  fake Pool; real `CREATE TABLE` was not live-verified in this walkthrough)

## Prerequisites

- A checkout of the target repo at or after `f4bb662`
- Node.js 22, pnpm 9.12.0
- No credentials, no Stripe/Shopify/Meta keys, no database.
  The rehearsal step explicitly strips `META_*`, `STRIPE_*`,
  `SHOPIFY_*`, `PROVIDER_*`, `OIDC_*`, `SHOP_OIDC_*`, and
  `DATABASE_URL` from its environment, and sets
  `MUSE_AGENT_ENABLED=false`.
- For the BI steps, a *local* API server is required (see Step 7).
  The walkthrough task that produced this doc did not run a live
  server, so BI HTTP routes are code-verified and unit-tested here,
  not live-verified. Do not claim a live BI response until you have
  actually run one.

## Step 0 — Build (required before rehearsal)

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

Expected: typecheck 24/24 and build 15/15 in CI's local inventory
at the prior HEAD; CI #39 for `f4bb662` passed the same steps in
GitHub Actions. If `pnpm build` fails, stop — the rehearsal step
requires `apps/api/dist/muse-agent-host.js` and exits with code 2
without it.

## Step 1 — Demo Reel bridge: intent → one batch → one review preview

File: `apps/demo/src/reel-demo-bridge.ts`
Test: `apps/demo/test/reel-demo-bridge.test.ts`

The bridge header is the contract: "DEMONSTRATION HARNESS — NOT
native Meta/Reels entry, NOT account linking, NOT a trusted
confirmation callback, and NOT a live Shop integration."

Run the bridge test (part of the competition-demo package tests):

```sh
pnpm --filter @gift-signal/competition-demo test
```

Expected, using the synthetic test fixture (not a real company or
product):

- Incomplete input → `next: 'COLLECT_BATCH'`, `review: null`,
  `plan.missing` = `['shop_identity', 'payment_authorization',
  'shipping_address', 'quantity', 'confirmation_email']`,
  `draft: { signed: false, draftId: null, draftHash: null }`.
- Complete input (quantity 1, verified Shop identity, verified
  payment authorization, shipping address, confirmation email) →
  `next: 'FINAL_REVIEW'`, one review preview:
  seller `'Demo Seller'`, title `'Atlas Carry-On 22'`,
  quantity 1, unit price 289, subtotal 289, currency `USD`,
  `paymentLabel: 'Saved payment'`, `approvalRequired: true`,
  `approvalToken: null`.

**Critical handoff — read this before presenting the demo:**
The bridge does **not** create or sign a server draft and does
**not** issue approval. Its `draft.next` is
`'EXISTING_DRAFT_SERVICE'`. The next step is a separate,
server-side draft creation by an authenticated company caller.
Presenting the bridge review as a signed draft, an approval, or a
payment would be a false claim.

## Step 2 — Signed draft creation (authenticated company caller only)

Route: `POST /v1/provider-transaction-drafts`
File: `apps/api/src/index.ts` (draft route), `apps/api/src/provider-transaction-draft.ts`

Caller requirements (all enforced server-side, never from browser
or model input):

- Authenticated principal with the `request_payment` capability;
  the company is `principal.orgId`, never a caller-supplied
  company field.
- `connectionId` (string, ≤160 chars)
- `description` (string, ≤500 chars)
- `successUrl` / `cancelUrl` (https only, no embedded credentials)
- `payment`: provider `stripe` (default) or `shop_pay`, plus a
  non-empty `externalAccountId`. If `paymentVehicle` is supplied
  it must agree with the provider.
- `fulfillment`: provider `shopify`, `externalAccountId` matching
  `^[a-z0-9][a-z0-9-]*\.myshopify\.com$`, 1–100 line items, each
  a `gid://shopify/ProductVariant/<digits>` variant ID with an
  integer quantity 1–100, plus a shipping address with
  `address1`, `city`, `countryCode` (2 letters), and `zip`.
- Server-owned display data, optional but required for a
  non-degraded review:
  - `sellerDisplayName` — validated, never derived from the
    shop domain, never equal to `externalAccountId`, never
    matching `gid://`, `myshopify.com`, or `acct_`. On success
    it is also upserted into the persisted seller-manifest
    store; a store failure returns 503
    `seller_manifest_store_unavailable`.
  - `itemTitles` — a map from variant ID to title; a title
    must never equal its variant ID or contain `gid://`.
  - `terms`, `paymentTiming`, `estimatedArrival` — each
    optional, trimmed, ≤1000 chars, no raw-ID pattern.
    Estimated arrival is only a supplied fulfillment estimate;
    it is never invented or guessed.

Mapping from Step 1 to Step 2 (the presenter does this mapping;
the bridge does not do it automatically):

| Bridge review field | Draft creation field |
|---|---|
| seller `'Demo Seller'` (demo only) | `sellerDisplayName` (real company display name, server-validated) |
| title per offer | `itemTitles[ variantId ]` |
| quantity, price, currency | pricing/landed quote from the provider runtime (`quoteVariants` + `quoteLandedTotal`); the draft amount is the landed total, not the bridge subtotal |
| shipping address (one batch) | `fulfillment.shippingAddress` |
| `paymentLabel: 'Saved payment'` | `payment.provider` (`stripe` default, or `shop_pay` with the blocked-execution stub) |

Expected: `201` with the signed draft state and approval
envelope carrying `sellerDisplayName`, item titles, terms,
payment timing, and estimated arrival when supplied.
Legacy drafts without them still create, but their review
shows "not available" for the missing facts and fails closed
instead of showing a raw ID. A tampered signed state fails
(`provider_transaction_draft_state_invalid`) rather than
leaking an invalid fact.

Blocked here, by design, not a demo bug:

- Live provider pricing/fulfillment requires an authorized
  provider connection and runtime; without it, draft creation
  returns 502/404/409 from the pricing step, not a fake quote.
- Shop Pay execution is blocked (`shop_pay_execution_blocked`)
  after drift/approval verification, before execution, and
  does not consume the approval JTI.

## Step 3 — Host review + storefront sheet

Files: `apps/api/src/muse-agent-host.ts` (`present_review`),
`apps/storefront/src/muse-confirmation.ts`
(`museConfirmationSheet`, `renderMuseConfirmation`)

Expected review, on both surfaces, consistently:

- Seller: resolved display name only. Missing, equal to
  `externalAccountId`, or matching a raw-ID pattern →
  `muse_review_seller_display_required` / fail closed.
  No fallback to the raw shop domain.
- Payment: exactly `'Saved payment'` for Stripe, or
  `'Shop Pay · Saved payment'` only for `shop_pay`.
  Raw account IDs are never rendered.
- Items: resolved titles only. Missing, equal to the
  variant ID, or containing `gid://` →
  `muse_review_item_title_required` / fail closed.
- Ship-to: full address (name, address1/2, city/province,
  country, zip). Phone is not rendered.
- Terms, payment timing, estimated arrival: rendered when
  supplied in the draft; otherwise "not available".
  A raw-ID value in any of these throws
  `muse_confirmation_unsafe_display` on the storefront.

## Step 4 — Live confirmation page + Buy guard + owned status

Files: `apps/storefront/src/muse-confirmation-page.ts`
(exported from `apps/storefront/src/index.ts`),
`apps/storefront/src/muse-buy-guard.ts`,
`apps/storefront/src/muse-confirmation-example.ts`
(example only, NOT a live page, not imported by `main.ts`)

How to present it:

- The host embeds the page by calling
  `mountMuseConfirmationPage()` on a container element,
  supplying the signed approval envelope server-side.
  The envelope is never parsed from browser JSON,
  localStorage, or a query string.
- The sheet is built from the signed envelope only and
  fails closed on a missing seller/title, a
  vehicle–provider mismatch, or a raw ID. Exactly one
  `data-muse-buy` button may exist; mounting throws
  otherwise, so exactly one guard attaches.
- Buy guard (`attachMuseBuyGuard`): the button disables
  immediately on first click with a progress label; a
  second in-flight click is ignored; after submit it
  stays disabled on "Checking status…" until owned
  status resolves; on failure it re-enables without
  auto-retry. The guard never grants approval —
  server consume-once approval, draft-hash
  revalidation, and provider idempotency remain
  authoritative, and this page itself executes no payment.
- Submit: `POST {apiBase}/v1/muse/confirm` with
  `{connectionId, draftId, approvalToken}`. No `apiBase`
  or no `approvalToken` → `muse_confirmation_server_not_configured`,
  zero network calls, never a fake success.
  Without a saved payment authorization for the buyer,
  the server returns 409
  `consumer_commerce_enrollment_required`.
- Owned status / reconnect: `GET /v1/muse/orders/{draftId}`
  (buyer identity from verified server-side auth;
  tracking `PENDING` / `AVAILABLE` / `UNAVAILABLE`).
  A retrieved order/tracking record does not prove
  delivery. On reconnect, `resume()` re-reads owned
  status by draft ID: processing/fallback states resume
  without a new approval; `RECONCILE_REQUIRED` goes to
  reconciliation, never blind retry; drift or expiry
  → `reapproval_required`, and only then is a fresh
  review presented.

Blocked here, by design, not a demo bug:

- Without a configured live API server (`apiBase`,
  approval token, identity, saved payment authorization,
  provider runtime, approval signing secret, transaction
  agent ID), submit fails closed with 503/409 as above.
  That is the correct demo outcome for an unconfigured
  server, not a failure to fix by weakening a check.

## Step 5 — Offline rehearsal (the repeatable no-money run)

```sh
node scripts/rehearse-muse.mjs
```

Expected (CI #39 for `f4bb662` passed this step in
GitHub Actions; locally at the prior HEAD it was
126 pass, 0 fail, 1 pre-existing skip):

- Header: "OFFLINE REHEARSAL: model and provider
  transports are mocked. No live Muse result, training
  job, payment or merchant order."
- `MUSE_AGENT_ENABLED=false`, and `META_*`, `STRIPE_*`,
  `SHOPIFY_*`, `PROVIDER_*`, `OIDC_*`, `SHOP_OIDC_*`,
  `DATABASE_URL`, and enrollment-test database variables
  are stripped from the rehearsal environment.
- Tests run: `tests/reel-muse-purchase-e2e.test.ts`,
  demo tool-agent and commerce tests, Muse host,
  consumer enrollment, confirmation submit, transaction
  execution, paid-fulfillment reconciliation, refund
  compensation, refund webhook, and Stripe payments
  tests — all with mocked transports.

This is the step to run live in front of an audience
when no server or credentials are available. It proves
the flow logic, not a live transaction.

## Step 6 — BI demo (supplied events only)

Files: `apps/api/src/muse-bi.ts`, `apps/api/src/muse-bi-store.ts`
Docs: `docs/muse-bi.md`
Routes (authenticated, company-scoped, read-only):

```sh
# Without demo events configured — expected 503, not invented data:
curl -H "Authorization: Bearer <company-auth-token>" \
  "$API_BASE/v1/muse/bi/report"

# With demo events configured (server side only):
MUSE_BI_DEMO_EVENTS_JSON='<validated supplied events JSON>' \
  # then, as the authenticated company principal:
curl -H "Authorization: Bearer <company-auth-token>" \
  "$API_BASE/v1/muse/bi/report?metric=funnel_counts"
curl -H "Authorization: Bearer <company-auth-token>" \
  "$API_BASE/v1/muse/bi/dashboard"
curl -H "Authorization: Bearer <company-auth-token>" \
  "$API_BASE/v1/muse/bi/export?format=csv"
```

Expected:

- Every report is labeled `DEMO/SUPPLIED EVENTS`
  everywhere (JSON `dataSourceLabel`/`demoLabel`,
  dashboard banner, CSV header).
- Verification contract: every metric carries definition
  name + version, source/version, `computed_at`,
  freshness SLA, code version, SHA-256 input hash,
  and status `verified | stale | unverifiable`.
  Stale is shown only labeled "stale"; unverifiable
  is blocked from current claims.
- Tenant trimming before aggregation: company ID comes
  only from the authenticated principal
  (`principal.orgId`). A `?companyId=` that differs
  fails closed with 403 `bi_tenant_mismatch`; an empty
  principal fails closed.
- Approved metrics only: `funnel_counts`,
  `funnel_conversion`, `verified_orders`,
  `attributed_revenue`, `roas`. Approved dimensions
  only: `campaignId`, `reelId`, `acquisition`,
  `paymentVehicle`. Anything else is rejected, never
  answered with a fallback query.
- Attribution: 30-day window; one outcome attributed
  once per draft ID (later verified outcomes for the
  same draft are duplicates, not new revenue);
  refunds subtract, cancelled outcomes contribute 0;
  ROAS uses paid attributed revenue only, and without
  supplied spend it is `unverifiable` with
  `roas: null`, never invented; organic vs paid is
  set at event creation (campaign present = paid,
  absent = organic) and never inferred later.
- Watermark: advances only on verified successful
  ingestion; on failure it does not advance, the last
  verified artifact is retained, and output becomes
  `stale` or `unverifiable`.
- Forensics/remediation are proposals only, with risk,
  rollback, owner, and measurable success criteria,
  requiring human approval, and never auto-retrying
  a payment (`autoRetryPayment: false`).
- BI never changes campaigns, budgets, routing,
  ranking, or policy.

Blocked here, by design:

- Without `MUSE_BI_DEMO_EVENTS_JSON`, routes return
  503 `muse_bi_demo_events_not_configured`.
- There is no live Meta ad ingestion path. Do not
  present BI as live Meta reporting.

Live-verified against a locally running API server
(2026-10-26, no deployment, supplied events only):
`GET /v1/muse/bi/report?metric=funnel_counts`
returned `DEMO/SUPPLIED EVENTS`, verification status
`verified`, and funnel counts 1/1/1/1/1 for the
authenticated company only — an event belonging to
another company was excluded (tenant trimming live,
not just in code). `GET /v1/muse/bi/dashboard`
returned 200 HTML, `GET /v1/muse/bi/export?format=csv`
returned the labeled CSV, a differing `?companyId=`
returned 403 `bi_tenant_mismatch`, and a server
without `MUSE_BI_DEMO_EVENTS_JSON` returned 503
`muse_bi_demo_events_not_configured`. That is a
local-server demo response, not live Meta reporting.

## Step 6b — Generic profile (explicit registration only)

Files: `apps/api/src/muse-generic-profile.ts`,
`apps/api/src/index.ts` (host wiring)
Routes (authenticated company principal only):

```sh
# Register this company's own generic profile only.
# companyId is principal.orgId; a body companyId that
# differs is rejected, and no classification is ever
# inferred from a name or domain.
curl -X POST -H "x-org-id: <company-id>" \
  -H "x-api-key: <company-api-key>" \
  -H "content-type: application/json" \
  -d '{"evidenceRef": "<server-side enrollment/connector record>"}' \
  "$API_BASE/v1/muse/generic-profiles"

curl -H "x-org-id: <company-id>" \
  -H "x-api-key: <company-api-key>" \
  "$API_BASE/v1/muse/generic-profiles/me"
```

Expected:

- A registered company resolves to the generic
  profile in the Muse host (`resolveExecutionProfile`
  returns `'generic'`), with generic readiness true,
  so executes go through `ZeroTrustConnectorRuntime`:
  exact approval, consume-once, drift revalidation,
  single execution claim, uncertain completion
  becomes `reconciliation_required`, never a retry.
- An unregistered company stays on the reference
  (Stripe/Shopify) path. A placeholder evidence
  reference, a company mismatch, or the synthetic
  fixture companyId (`synthetic-fixture-demo-only`)
  is rejected. The synthetic fixture is never
  registered as an adapter and never wired to a real
  company.
- Registration alone does not commit anything:
  execution additionally requires a connector adapter
  registered in-process by the server operator
  (adapters are never registered over HTTP). Without
  one, generic submit fails closed with
  `muse_generic_connector_not_registered` and no
  approval is consumed. Without a database
  (`DATABASE_URL` unset), the routes return 503
  `generic_profile_store_not_configured` — fail
  closed, not a silent reference fallback.

## Step 7 — What "done" looks like, and what is still not done

Done, including the finish-all work (2026-10-26):

- Copy + rebrand to Muse Shopping Index, readable
  workflow docs, review fix, wiring, Buy guard, draft
  extension, generic host support, Meta gate,
  Shop Pay vehicle (blocked execution), persisted
  manifest store, live confirmation page, BI demo
  gates, training files in target.
- Generic profile production wiring into
  `apps/api/src/index.ts`: explicit Postgres-backed
  company -> generic registry, host profile resolver,
  generic readiness gate, verified signed generic
  draft resolver, and `ZeroTrustConnectorRuntime`
  submit — see Step 6b for the adapter caveat.
  The synthetic fixture is never wired to a real
  company.
- BI demo verified against a locally running server
  with supplied events only (see Step 6).
- Deployment decision: Option B — no deployment for
  Nov 3, local/demo + CI green only (user choice
  2026-10-26). No host, no paid plan, no old-config
  reuse.

Still not done, and out of scope for this walkthrough
unless they block the demo above:

- Workflow edits (user account only, no Workflows
  permission for Muse): add
  `apps/api/test/muse-seller-display.test.ts` and
  `services/mcp-gateway/test/provider-oauth.test.mjs`
  to CI's explicit test list. Neither blocks CI green
  for the listed inventory. Ready-to-apply patch
  prepared in the finish-all work (workspace file,
  not committed).
- Binary image `apps/storefront/public/images/gift-editorial.webp`
  — user direct git push only; not required for CI
  or for this demo.
- Full internal rebrand (`@gift-signal/*`, `gift-signal:`
  prefixes, `GIFT_SIGNAL_API_KEYS`) — audited and
  intentionally NOT renamed: package scope is
  workspace-private, env-var names are an operator
  contract (a hard rename silently breaks API auth),
  and Stripe `gift-signal:` idempotency prefixes must
  never change (a renamed key is no longer deduplicated
  against the original request). Do not rename for
  branding reasons.
- Live Shop, live Meta, live Shop Pay execution, live
  payment, live Meta ad ingestion, real Postgres
  verification, consumer-enrollment test against a
  real Postgres (needs `ENROLLMENT_TEST_DATABASE_URL`
  and a Postgres service, as CI provides) — all
  still unverified/blocked, as documented in the
  evidence table. A generic profile without an
  operator-registered adapter also stays blocked at
  submit time, by design.
