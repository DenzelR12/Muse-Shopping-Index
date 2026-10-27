# Muse Shopping Index — Indie Submission Brief

Status: submission brief, not a live claim. Written against target main HEAD
`d49c309673d56127a886bba001250b3ab73ad355` (2026-10-27). Everything below
is either code-verified, demo-verified, or explicitly marked as not done.
No live Shop handling, live Meta/Reels distribution, live payment, live
Shop Pay execution, live Meta ad reporting, or live shipment is claimed here.

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

### Meta catalog integration plan (new work, in order, not done)

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

Until steps 1–5 are done, every catalog claim in this project is
"supplied events / supplied items only," and must stay labelled that way.

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
  ROAS) in `docs/company-intelligence-reports.md`, not as a live Meta Ads
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

Demo recommendation (not yet recorded): show one failure case and its
recovery in the demo video — for example, a price change after review
triggering reapproval — because judges remember a recovered failure more
than a second happy path.

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
  for the user, not answers in the source.
- **Business model:** none found. No fee, commission, subscription
  price, or revenue model exists in the source or target. Who pays, and
  for what, is an open decision for the user.

## Remaining live blockers (not done)

1. Render Postgres: card tomorrow, then create `muse-shopping-index-db`
   at $10.50/month (PostgreSQL 18, Oregon, $6 compute + 15 GB storage
   $4.50), fresh database, never the old gift-signal database.
2. `DATABASE_URL` (linked from the new database) plus the remaining
   environment variables, set by the user in Render only, never in chat
   or in the repo. The Render API service is deployed and responding
   (commit `a152d08`, URL `https://muse-shopping-index-api.onrender.com`),
   but its root currently returns
   `persistent_rate_limit_not_configured` — server running, persistence
   and database configuration missing, not a completed live API.
3. One real company end to end in test mode: profile, adapter,
   authorized provider connection, manifest → TRANSACTION_READY.
4. A measured clicks/time number: time or clicks from Reel tap to
   approval, before versus after, measured on a real run.
5. A 90-second demo video with a failure/reapproval case, ending on the
   honest close: green CI, no-money demo, credential-gated live paths.
6. Real Postgres verification (against the Render database once it
   exists) and a real-browser confirmation run — both currently
   code-verified, not live-verified.
7. External approvals, in order: Meta Reels distribution, Meta
   verification channel acceptance, Meta catalog connection (section 2
   above), Shop partnership / backend handling / identity, each real
   company's authorized provider connection, Stripe live credentials
   and webhook delivery. Real money only with explicit approval of that
   exact transaction, never automatic after the steps above.

See also: `docs/demo-walkthrough.md` (no-money demo),
`docs/live-readiness.md` (credential-gated live activation points),
`docs/render-deployment.md` (live Render deployment status and tomorrow
checklist), `docs/real-model-agent-test.md` (real-model agent-host test,
mock host, no live agent).
