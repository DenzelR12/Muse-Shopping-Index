# Muse Shopping Index — Indie Submission Brief

**Watch the pitch (2:57):** [Muse Shopping Index — pitch video](https://denzelr12.github.io/Muse-Shopping-Index/muse_demo-video.MP4)


Status: submission brief, not a live claim. Updated 2026-10-28: first live Meta catalog read verified via Graph Explorer (see docs/meta/live-meta-catalog-proof.md); the section below that said no Meta catalog connection exists is now superseded for the TEST catalog read only — it is not a read through the repo client, a live seller, or live payment. Updated 2026-10-30: the repo client has now read the same TEST catalog live, running on Render — all eight verification checks pass (see the proof doc's 2026-10-30 addendum and screenshot). Still not a live seller, not a review built from live catalog data, and not live payment. Everything below
is either code-verified, demo-verified, or explicitly marked as not done.
No live Shop handling, live Meta/Reels distribution, live payment, live
Shop Pay execution, live Meta ad reporting, or live shipment is claimed here.

**Measured on the live demo (2026-10-31, demo v61):** Reel tap → approval takes **3 taps** when Muse Spark's live verdict is an exact match (THEENRG tee — Shop this reel → See the exact review → Approve Purchase; the model is consulted live on the first tap, so the evidence card is one of the three). When the live verdict is uncertain it asks "Which one?" first: **4 taps**, the extra taps being the live consultation and the safety behavior working as designed. The ClutchAgent service flow takes **2 taps** (Shop this reel → Approve Service Access). Clicks only: no time claim (reading time is the reader's), and no before/after baseline exists yet.

## 1. Track: Indie developer

The user has chosen the **Indie developer track** for the Meta Global AI
Developer Hackathon.

Indie is judged on creativity, technical ambition, and whether it works —
not on startup production-readiness. That is the lens this brief is written
for: a creative, technically ambitious product with a working demo, whose
live path is honestly credential-gated and approval-gated rather than
oversold.

Submission deadline (competition): November 4, 9:00 PM ET. The user's own
November 3 deadline remains the buffer.

## 2. Meta catalogs: the straight answer

**No Meta catalog API or connection exists in the source or in the target
today.** Meta catalog access is not something this project already has, and
it must not be presented as if it were.

**Update 2026-10-30 — the paragraph above is superseded for the TEST
catalog.** A read-only Meta catalog client now exists in the target
(`apps/api/src/meta-catalog.ts`), is registered at server startup, and
has read the ClutchAgent Test Catalog live through the deployed
service on Render: one item, verified title, price, currency and
availability, 24-hour freshness window, raw IDs stripped — all eight
harness checks pass (proof: [live Meta catalog proof](../meta/live-meta-catalog-proof.md),
2026-10-30 addendum and screenshot). Plan steps 1–4 below are done
for this TEST catalog. Step 5 is done only up to the verified live
read: an exact review built from live catalog data, and an explicit
approval on it, have not run. Commercial sellers still require
per-seller authorization and, for Live mode, Business Verification
plus App Review.

What "catalog" actually means in the source (`DenzelR12/the-gift-signal`,
HEAD `d4e90535e0b7097d4493e07911f5dbf033477190`, audited read-only):

- Provider catalogs synced from Walmart, eBay, Etsy, and Amazon
  (`services/mcp-gateway/src/provider-sync.ts`: `syncWalmartCatalog`,
  `syncEbayInventory`, `syncEtsyListings`, `syncAmazonListings`).
- Company-supplied items validated by `catalogItemSchema`
  (`services/mcp-gateway/src/business.ts`), with 24-hour freshness: a price
  or stock record older than 24 hours must be refreshed.
- Catalog readiness that is **evidence-supplied, never a Meta check**:
  `deriveProviderReadinessEvidence` in `apps/api/src/provider-readiness.ts`
  sets `catalogValidated` from a boolean supplied by the caller plus a
  granted `catalog.read` capability. No Meta API call verifies it.

Source readiness ladder, exactly as written in
`apps/api/src/onboarding.ts`:

```
CONNECTED → VERIFIED → TRANSACTION_READY → AUTONOMOUS_READY
```

with `metaBusinessRequired: false`, `providerNeutral: true`, and
`metaIsOptionalDistributionSurface: true`.

Correction to an earlier shorthand: the ladder
`CONNECTED → META_VERIFIED → CATALOG_VERIFIED → TRANSACTION_READY →
AUTONOMOUS_READY` is a **target-repo Meta-gate addition** from the later
Meta business-verification work. It is not the source ladder, and it must
not be cited as source behaviour. In the target, META_VERIFIED and
CATALOG_VERIFIED are evidence-recording gates, not live Meta checks.

### Meta catalog integration plan (new work, in order — steps 1–4 done for the TEST catalog, 2026-10-30)

1. A business authorizes a Meta catalog connection for its own business
   (Meta Business Manager, authorized catalog, read access granted by
   that business — never by Muse, never by a model, never by a demo).
2. A Meta Catalog API client is registered at server startup, read-only
   for catalog data, exactly like the existing live Meta ad ingestion
   interface: it fetches, it never changes campaigns, budgets, routing,
   or ranking.
3. Catalog data fetched through that client is validated against the
   existing catalog item rules (resolved display name and title, price,
   stock, freshness) before it can feed a draft or a review. Unverified
   or stale catalog data fails closed and never reaches a consumer
   review.
4. Only verified catalog evidence advances a company through the target
   Meta gate toward CATALOG_VERIFIED and then TRANSACTION_READY, under
   the same evidence rules as Meta business verification (no
   self-attestation, no placeholder evidence, no future or expired
   evidence).
5. A live catalog run is then verified end to end in test mode before
   any production claim: one real business, one real catalog item, one
   exact review built from catalog data, one explicit approval.

Until step 5 completes — an exact review and an explicit approval
built on live catalog data — every catalog claim beyond the one
verified TEST-catalog read stays "supplied events / supplied items
only," and must stay labelled that way.

### Shopify catalog client — code only, same honesty rule (added after HEAD 11b51a3)

A read-only Shopify catalog client now exists in code
(`apps/api/src/shopify-catalog.ts`, [Shopify catalog client](../sellers/shopify-catalog.md)),
mirroring the Meta catalog client: Storefront API product query
only, gated, TEST-labelled, with title/price/currency validation,
24-hour freshness, and raw IDs stripped. It has **no cart,
checkout, write, order, or customer endpoint**, and Shopify is a
provider behind the server, never the frontend — this is a Muse
feature, not a storefront. Its endpoint/version shape is **not
live-verified against a real store**, no live Shopify read, store,
token, or seller is verified, and a store-owner call about a real
store is pending. Until a real read is verified against a real
store, every Shopify catalog claim stays labelled the same way
as the Meta ones above: code only, not a live connection.

### Panel host wiring — done in code, not live traffic (added after HEAD 11b51a3)

The Muse feature panel's callbacks are now mapped to existing
server methods by a host-side adapter
(`apps/api/src/muse-panel-host.ts`, [Panel host wiring](../platform/panel-host-wiring.md)):
approve → existing signed-draft approval flow (consume-once,
host-supplied token only), resume → host `resumeDraft()`
(revalidates first), reminder opt-in/opt-out → existing reminder
functions (principal only). No new public route was added, and
no live HTTP traffic or native Muse window integration is
claimed: wiring here means callback → server-method mapping
plus tests, and live routes plus the native renderer remain
separate steps.

## 3. Meta surface feature framing

Muse is the surface where Reel intent becomes an exact, server-verified
review.

- **Reel intent in:** intent built from `platform: 'meta'`, `reelId`,
  caption, and product hints, with the next step `MUSE_REVIEW`
  (`apps/demo/src/reel-commerce.ts`: `createReelCommerceIntent`).
- **Muse interpretation:** `interpretWithMuse` calls the Meta Model API
  chat completions endpoint with the configured Muse model, falling back
  to a deterministic intent when the model is unconfigured — never
  inventing an interpretation.
- **Server-signed exact review out:** the agent host is built around
  Muse's tool-call flow, with allowed keys only
  (`connectionId`, `draftId`, `message`, optional `approvalToken`), and
  the deterministic server — not the model — authorizes, signs, and
  executes. The consumer sees one exact review and approves it once.

### What is NOT native — stated plainly

- No native Reel entry-to-draft integration exists in the source or in
  the target today. The demo Reel bridge is a demonstration harness: it
  builds intent from *supplied* reelId/caption/product hints, searches
  supplied offers, and never signs a draft, issues an approval, executes
  a payment, or claims a live Shop or Meta callback.
- No Meta distribution approval, no native "Shop this reel" button, and
  no Meta callback/webhook integration. Captions are explicitly untrusted
  data in the policy, and the host starts only from an existing owned
  signed draft.
- Meta ad attribution exists only as a BI reporting contract
  (impressions → clicks → Muse opens → drafts → approvals → purchases →
  ROAS) in `docs/platform/company-intelligence-reports.md`, not as a live Meta Ads
  connection. Live ad ingestion in the target is a credential- and
  client-gated read-only interface, not a live connection today.

Honest framing for the submission: *"Muse is the surface where Reel
intent becomes an exact, server-verified review."* Not: "a native Meta
feature." Distribution approval and a real Reel-entry integration are
still missing, and they are listed as blockers below.

## 4. Failure cases for the demo (from source code)

These are state machines and validators in code, not documentation
aspirations. They are showable in the demo only with synthetic state
transitions, because the demo path uses mocked/demo transports — no live
provider failure has been exercised.

- **Changed price, tax, shipping, configuration, terms, or payment
  authorization since review:** `changedSinceReview` →
  `request_reapproval`. A changed review is never executed on the old
  approval.
- **Expired approval or draft, or hash / authorization mismatch:**
  expired `expiresAt`, or an approval that does not match the exact draft
  hash plus the saved authorization reference, → `request_reapproval`.
- **Uncertain order completion:** execution state `RECONCILE_REQUIRED`
  → `escalate_reconciliation`. Policy: never execute again after a
  timeout, ambiguous response, webhook delay, or payment success.
  Uncertainty goes to reconciliation, never to a blind retry.
- **Refund:** `REFUND_REQUIRED` → `REFUND_EXECUTING` →
  `REFUND_SUBMITTED` → `REFUNDED`. Submitted is not verified refunded: a
  failed refund restores `REFUND_REQUIRED` and never silently completes.
- **Payment authentication fallback:** `PAYMENT_FALLBACK_PENDING` /
  `AUTHENTICATION_REQUIRED` → trusted Stripe Checkout only. Never a
  model-selected or merchant-supplied URL.
- **Cancellation:** no dedicated cancelled state exists in the
  transaction store. Cancellation is expressed via refund states and via
  the `order.cancel` capability in the readiness manifest, not as a
  separate order state.

Demo recommendation: show one failure case and its recovery — for
example, a price change after review triggering reapproval — because
judges remember a recovered failure more than a second happy path.
This is in the product today: the live demo's tee review carries a
Test price change (TEST) case ($52.52 → $54.52, old approval refused,
reapproval required), and the 2:57 pitch includes a "try to break
it" section.

## 5. Privacy, solved

One sentence the code supports:

> "Each company's credentials, orders, and reports are keyed to its own
> authenticated identity and can never be read or used by another
> company, and each consumer can only ever see their own orders."

Code that supports it:

- Company scope comes from the authenticated principal:
  `ApiPrincipal.orgId` from the API-key registry (`api_credentials`
  table keyed by `org_id, credential_id`, hashed secrets).
- Readiness throws `provider_readiness_company_mismatch` if a
  verification connection's company does not match the requesting
  company.
- Provider tokens are sealed per tenant:
  `PostgresTenantProviderCredentialVault` keys ciphertext by
  `companyId + provider + externalAccountId` (tenant key HMAC plus
  authenticated associated data); a decrypt mismatch throws
  `provider_token_tenant_mismatch`.
- Consumer side: the host's `owned()` check requires the connection's
  subject to match the authenticated identity, and transaction company
  and consumer subject must match, else `consumer_agent_not_found`.
- Business intelligence: every event carries a company ID, queries and
  reports filter by that ID **before** aggregation, and reporting is
  read-only — it never changes campaigns, budgets, routing, ranking, or
  policy on its own.

What this does **not** prove: a privacy audit, a data-processing
agreement, or GDPR-style compliance. Those are legal documents, not
present in the code, and they must not be claimed from this sentence.

## 6. Why Muse, solved

> "Muse is where the Reel already lives. A Reel creates intent, Muse
> interprets it, and the server — not the model — turns it into one
> exact, signed review with one explicit approval. No other surface
> gives you Reel intent, Muse interpretation, and a verified review in
> the same place, and no model, caption, or demo bridge can grant that
> approval or sign that draft."

The differentiator is the split of labour, and it is the whole product:

- **The model proposes.** It interprets intent, collects missing details
  in one batch, and proposes the next tool step.
- **The server authorizes.** It resolves the seller display name and
  item titles from the authenticated company caller only, signs the
  exact draft, binds the approval to the exact draft hash, total,
  currency, and saved payment authorization, consumes that approval
  exactly once, revalidates on drift or expiry, and reconciles on
  uncertainty instead of retrying.
- **The human approves, once.** No model text, caption, browser field,
  or demo bridge can grant approval, sign a draft, or supply seller
  titles. Raw provider IDs fail closed in the review, never leak to the
  consumer.

The portable transaction core is a strength, not a weakness: signed
drafts, exact approval, and reconciliation work across providers because
Shopify and Stripe are adapters, never a requirement. What is not
portable is the surface itself — Reel intent, Muse interpretation, and a
verified review in the same place. That is why this is a Muse product
and not "an AI chatbot with a buy button."

## Still open decisions (not done, not hidden)

- **First real seller:** none. All demo data in source and target is
  synthetic only — Demo Seller, Atlas Carry-On 22 ($289), Demo
  Headphones in the $58 test draft, and the source's four invented demo
  companies (Atlas, Nomad, and two Orlando travel packages, dated
  2026-10-24). The first real seller and its product are open decisions
  for the user, not answers in the source. Update after HEAD 11b51a3:
  a read-only Shopify catalog adapter now exists in code so a
  store-owner call can be answered with ready code, but no store,
  token, or seller is verified yet — the first real seller is
  still open, and a store-owner call is pending. Update 2026-10-30:
  the ClutchAgent TEST catalog has since been read live through the
  repo client (section 2) — a test catalog, not a commercial seller;
  the first real seller is still open.
- **Business model:** none found. No fee, commission, subscription
  price, or revenue model exists in the source or target. Who pays, and
  for what, is an open decision for the user.

## Remaining live blockers (not done)

1. Render Postgres: DONE — `muse-shopping-index-db` created
   2026-10-28 at $10.50/month (PostgreSQL 18, Oregon, $6 compute +
   15 GB storage $4.50), fresh database, never the old gift-signal
   database.
2. `DATABASE_URL` and the Meta catalog environment variables are set
   in Render (values never in chat or in the repo). The API service
   runs on Render Starter (`https://muse-shopping-index-api.onrender.com`)
   and its root returns `{"error":"unauthorized"}` — deployed and
   auth-gated, not a completed live API: no live panel traffic or
   seller execution yet.
3. One real company end to end in test mode: profile, adapter,
   authorized provider connection, manifest → TRANSACTION_READY.
   The Shopify catalog adapter for that company's store is now
   code-ready (read-only, TEST-labelled); what is still missing
   is the store owner's authorization and a verified read
   against a real store, which is pending a call.
4. A measured clicks/time number — CLICKS MEASURED on the live demo
   (2026-10-31, demo v61): 3 taps from Reel tap to approval on a live
   exact match (the live model consultation is one of the taps); 4 taps
   when the live verdict is uncertain and asks "Which one?" first. Still open: a before-versus-
   after comparison and any time number, measured on a real run — no
   baseline exists yet, and reading time is not claimed.
5. Pitch video: DONE as a 2:57 cut (live at
   `docs/muse_demo-video.MP4`, linked at the top of this brief),
   including failure / "try to break it" material. It is not a
   90-second cut; the no-money demo and the credential-gated live
   paths are stated in this brief rather than claimed in the video.
6. Real Postgres verification of the panel / exactly-once stores
   against the live Render database (created 2026-10-28) and a
   real-browser confirmation run — still code-verified, not
   live-verified; the 2026-10-30 live run exercised the catalog
   client, not the Postgres stores.
7. External approvals, in order: Meta Reels distribution, Meta
   verification channel acceptance, Meta catalog for commercial
   sellers (per-seller authorization; Business Verification + App
   Review for Live mode — the TEST catalog connection in section 2
   is done), Shop partnership / backend handling / identity, each real
   company's authorized provider connection, Stripe live credentials
   and webhook delivery. Real money only with explicit approval of that
   exact transaction, never automatic after the steps above.

See also: `docs/submission/demo-walkthrough.md` (no-money demo),
`docs/operations/live-readiness.md` (credential-gated live activation points),
`docs/operations/render-deployment.md` (live Render deployment status and tomorrow
checklist), `docs/research/real-model-agent-test.md` (real-model agent-host test,
mock host, no live agent),
`docs/meta/meta-catalog-client.md` (read-only Meta catalog client;
TEST catalog live read verified 2026-10-30 — not a commercial seller
connection),
`docs/sellers/shopify-catalog.md` (read-only Shopify catalog client code, gated,
no live read verified — not a live Shopify connection),
`docs/platform/panel-host-wiring.md` (panel callbacks → existing server methods;
no new public route, no live HTTP traffic or native Muse window claimed).

## Muse entry contract — the aim (pointer only)

The product aim is: pressing "Shop this reel" on Meta opens a Muse
window to complete the purchase — exact review → one explicit
approval → server execution. The complete contract, including the
steps this project controls and the steps Meta must still provide,
is in `docs/platform/muse-entry-contract.md`. Nothing in this brief changes
because of that pointer: the native Meta button, Reels distribution
approval, and signed callback contract are still not obtained, and
the demo entry in `apps/demo/src/muse-entry-simulator.ts` is a
labelled DEMO SIMULATOR, not a native Meta button.

## Impact, Meta AI, and Technical — 2026-10-27 batch (code + protocol, not live)

This section was added after HEAD 57cc2f8. It is code and protocol
only. Nothing in it is a live seller, a live read, a live payment, a
live reminder, a live panel route, or a native Muse window, and
nothing in it changes a rubric score by itself — scores move only
when measured evidence is recorded under the protocols below.

- **Impact measurement:** [Impact measurement protocol](../research/impact-measurement-protocol.md) —
  A/B protocol (same seller, same product, Muse panel vs the seller's
  existing checkout flow as a control), timestamp definitions
  (tap → review, review → approval, approval → verified order,
  verified order → delivered), verified-only revenue, abandoned
  recovery counting rules from existing BI (tenant-trimmed, one
  outcome per draftId, refunds subtract, watermark only on verified
  success), consumer-protection rehearsal tables, and a no-dark-pattern
  checklist. No measured numbers exist yet; the tables are empty
  until a live test fills them.
- **Multi-seller pilot:** [Multi-seller pilot plan](../operations/multi-seller-pilot-plan.md) —
  three sellers, different categories and price points, read-only
  first, one test product each, tenant-scoped, revocable by uninstall,
  test-only. No sellers are verified yet; a store-owner call is
  pending later 2026-10-27.
- **Multi-company TEST demo (two tenants, TEST only):** [Multi-company test tenants](../sellers/multi-company-test-tenants.md) + `apps/demo/src/muse-multi-company-demo.ts` — Company 1 = THEENRG.COM (test, Shopify, Storefront read-only, physical TEST product); Company 2 = ClutchAgent (test, Muse Meta context, Meta catalog read-only, Reel entry, Muse panel — NOT a Shopify seller, NOT a service product). Shopify flow, then Meta flow, then Company 1 drift → reapproval with Company 2 unaffected, then tenant-trimmed verified-only BI. NOT live; no third real company (company C) in this batch; Meta Business Verification entity work NOT in this batch; THEENRG.COM real store/product/token and ClutchAgent Meta real catalog/System User/token still unverified at the time. Superseded in part 2026-10-30: the ClutchAgent TEST catalog, its System User, and its token have since been verified by live reads (section 2); THEENRG.COM real store/product/token remain unverified.
- **Product 100% checklist (code-100% vs live-100%):** [Product 100% checklist](../operations/product-100-checklist.md) — every item with status (Done in code / Code-ready not mounted / Blocked external), evidence, and owner. Code-100% is closed in code after the panel mount adapter + multi-company gates in this batch; live-100% remains blocked externally (THEENRG token/product, business model decision, Meta distribution, Shop Pay partnership, real money; the Render card/DB item and the ClutchAgent TEST catalog/token item closed on 2026-10-28 and 2026-10-30). Panel routes have since been wired in code (draft registry, session issuance, token store — see "Panel live wiring (added 2026-10-28)" below); the remaining gap is production host binding, not a missing store. Mockup realness is documented separately in [Mockup realness](../research/mockup-realness.md): AI mockups are DEMO only, never real screenshots.
- **Meta lead callback webhook, code-ready not mounted (separate from purchase):** [Meta lead webhook](../meta/meta-lead-webhook.md) — `apps/api/src/muse-lead-webhook.ts`, tests `apps/api/test/muse-lead-webhook.test.ts`, plus a provider-readiness gate. Webhook-first (`leadgen` field, HMAC-SHA256 signature, server-owned page → company mapping, deduplication by leadgen_id, PII minimized to full_name / phone_number / preferred_callback_date_time only); polling only as fallback/backfill. NOT live; no route mounted in `apps/api/src/index.ts`, no leadgen subscription, no `leads_retrieval` approval, no live lead or live Graph fetch verified. A callback request never grants approval, signs a draft, or executes a purchase.
- **Accessibility / multilingual as market expansion:**
  [Accessibility and multilingual expansion](../research/accessibility-multilingual-expansion.md) —
  real-text review, amount-labelled approval, diffs in words,
  pre-expiry warning, resume-by-draft, and verified review in profile
  language (profile → device, location never language, model
  translation never verified). No accessibility standard or audit is
  claimed. The demo UI translates into 48 languages (live-tested in
  Spanish); the exact review terms stay English until a verified
  translation exists, so no verified multilingual review is claimed.
- **Meta AI tooling:** [Meta AI tooling](../meta/meta-ai-tooling.md) — Spark
  1.3 for interpretation, Muse Image for DEMO-labelled demo visuals
  only (workspace files, not pushed to the repo, never seller product
  photos, never a price claim, no official logo), Meta Catalog API
  for verified reads (read-only client in code; TEST catalog live
  read verified 2026-10-30), Reel entry contract + simulator (not a
  native button),
  and a new multimodal intent candidate module
  (`apps/demo/src/muse-multimodal-intent.ts`) that never supplies a
  title, price, or stock level — the catalog record does, or the
  candidate is unverifiable. SAM 3.1 is not forced, no fine-tuning,
  Spark Open is not Spark 1.3, and no new paid Meta API probes were
  run in this batch.
- **Panel routes, code-ready not mounted:**
  [Live panel routes design](../platform/live-panel-routes-design.md) —
  `apps/api/src/muse-panel-routes.ts` (pure handler logic, fail-closed
  principal / tenant / draft checks, approval returns 202 accepted
  not executed) plus its tests and a provider-readiness gate. Since
  wired in code (see "Panel live wiring (added 2026-10-28)" below):
  index.ts resolves drafts through the registry and requests fail
  closed without an authenticated panel session — so there is still
  no live panel-to-API traffic, and the remaining gap is production
  host binding.
- **Technical verification:** [Technical verification checklist](../operations/technical-verification-checklist.md) —
  real Postgres (database created 2026-10-28; Postgres-backed store
  verification still pending), real-browser
  confirmation run, live Shopify read (blocked: store-owner call),
  live Meta catalog read (verified 2026-10-30 for the TEST catalog),
  end-to-end test order in test mode, latency measurement, and an
  adversarial evidence summary with standing caveats (CI-listed
  gates vs standalone files, no pnpm/Docker in the VM, provider
  gates need a full build and first run in CI).
- **Business model, still undecided:**
  [Business model options](../research/business-model-options.md) — four options
  (fee only on a verified order; seller subscription; platform / Shop
  backend share only where authorized; hybrid) with pros, cons,
  risks, and a decision-needed flag. No option is chosen, and no fee
  or revenue figure is claimed anywhere. The "Still open decisions"
  section above therefore remains true: business model undecided.

Training is unchanged in this batch: 48 teaching / 30 held-out
synthetic scenarios, no model trained or fine-tuned, no regeneration
run. Demo work is deferred to last and untouched in this batch: no
90-second cut re-assembly, no narration or mockup changes for the cut,
no Render Starter change, and no live URL claim.


## Exactly-once guard (added 2026-10-28)

Duplicates, retries, webhook redelivery, and bursts are handled by a shared claim in `apps/api/src/muse-exactly-once.ts` (see `docs/platform/muse-exactly-once.md`): one stable key per logical action per tenant, atomic Postgres claim, duplicate replay returns the original result, stale claims reconcile instead of auto-retrying, and a burst limiter that fails closed past its cap. Tested locally 8/8. Not claimed as live, not load-tested at 10,000 requests, and no scaled host or queue is configured yet — a burst is fail-closed, not guaranteed through.


## Panel live wiring (added 2026-10-28)

Draft registry, session issuance, and a live host adapter are now in code (`apps/api/src/muse-panel-live-wiring.ts`, see `docs/platform/muse-panel-live-wiring.md`), CI-gated via `provider-readiness.test.ts`. index.ts no longer returns a null draft. Live panel traffic is still blocked at one gap only: production host binding — a real Muse host must supply an authenticated panel session (consumer identity, connection, session token) and bind its host methods. No fake consumer, guessed connection, or body token is used to close that gap.
