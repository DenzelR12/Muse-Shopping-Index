# Render deployment status — Muse Shopping Index

Status as of the 2026-10-27 (UTC) Render check, at repo HEAD `a152d08`
(`a152d0842d0640ed1422b6e2e8504ec165922c31`), CI #51 green for that commit.

This document is a deployment-status record, not a live claim. The API
service is deployed and responding, but it is **not** a completed live API:
it has no database and no live configuration yet. Read
`docs/live-readiness.md` before claiming any path is live.

## What is deployed

- Render project: **Muse Shop**
  (`prj-dbg1of142hec73daqvjg`).
- Web service: **muse-shopping-index-api**
  (`srv-dbg1tq8m7kps73b5as9g`), Docker, Oregon.
- Source: GitHub `DenzelR12/Muse-Shopping-Index`, branch `main`.
- Public URL: https://muse-shopping-index-api.onrender.com
- Plan: **Free** ($0, 0.1 CPU, 512 MB RAM). A free service spins down
  with inactivity, and Render says that can delay requests by 50 seconds
  or more. The $7/month Starter upgrade was **not** approved and was
  **not** done.
- Most recent successful deploy: commit `a152d08`, in 50.7 seconds,
  shown as Live / Deployed. CI #51 is green for that commit.
- No storefront/demo service was created in Render. No service or
  database from the old gift-signal project was touched.

## Current root response — and what it means

The public URL currently responds at the root with:

```json
{"error":"persistent_rate_limit_not_configured"}
```

That means the server is running, but its persistence/database
configuration is still missing. It is **not** a completed live API, and
it cannot process transactions until the database and configuration in
tomorrow's checklist below exist.

## Deploy history

- `b80028a` — first deploy, failed in 12.6 seconds: pnpm
  `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` for
  `@gift-signal/bundle-orchestrator@workspace:*` in `apps/api`, because
  the Dockerfile only copied some workspace `package.json` files.
- `daf63f0` — failed in 26.8 seconds: TypeScript
  `TS2307 cannot-find-module` errors.
- `359066a` — failed in 25.2 seconds: TypeScript
  `TS2307 cannot-find-module` errors.
- `a152d08` — succeeded in 50.7 seconds. It builds workspace
  dependencies first, carries the built workspace and `node_modules`
  into the runtime image, and starts `apps/api/dist/index.js`.

CI green for a commit does not by itself prove the Render build passes;
the Render deploy log is the proof for that.

## Environment variables already set (non-secret only)

Only these non-secret values are set on the service. No real secret,
API key, password, Stripe key, or webhook secret was set:

- `NODE_ENV=production`
- `MUSE_AGENT_ENABLED=false`
- `LOG_LEVEL=info`
- `APP_MODE=demo`
- `SHOP_PAY_EXECUTION_ENABLED=false`

## Tomorrow's checklist, in order

Do these in Render's dashboard only. Never put a value in the repo,
chat, email, or logs — names only here.

### (a) Add a payment card in Render

Render requires a credit/debit card before creating a paid database.
It states a temporary $1 USD authorization to verify the card, not a
charge. No card was entered and no charge was made before this
document was written.

### (b) Create the Postgres database

Create a **fresh** database in the Muse Shop project. Never reuse the
old gift-signal database.

- Name: `muse-shopping-index-db`
- Engine/version: PostgreSQL 18
- Region: Oregon
- Cost: $6/month compute (0.1 CPU, 256 MB RAM) + 15 GB storage at
  $4.50/month = **$10.50/month total**

Do not substitute a free Render Postgres as the live database: free
Render Postgres expires in 30 days with no backups.

### (c) Link the database to the API service

Link the new database's `DATABASE_URL` to `muse-shopping-index-api`
in Render. Until `DATABASE_URL` is linked, live transaction paths
remain gated / fail-closed, as in `.env.example`.

### (d) Fill the remaining environment variables in Render only

Names only, from `.env.example` and `docs/live-readiness.md`:

- `DATABASE_URL`
- `REDIS_URL`
- `APP_BASE_URL`
- `BUSINESS_BASE_URL`
- `PORT`
- Signing/session secrets: `DRAFT_SIGNING_SECRET`,
  `APPROVAL_SIGNING_SECRET`, `AUDIT_SIGNING_SECRET`,
  `SESSION_SECRET`, `LINK_AUTHORITY_SIGNING_KEY`,
  `AUDIT_HASH_SECRET`, `PROVIDER_TOKEN_ENCRYPTION_KEY`,
  `PROVIDER_OAUTH_STATE_SECRET`, `PROVIDER_OAUTH_CALLBACK_URL`
- Operator API keys: `GIFT_SIGNAL_API_KEYS`,
  `GIFT_SIGNAL_API_KEY_HASHES`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Shopify: `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`,
  `SHOPIFY_WEBHOOK_SECRET`, `SHOPIFY_CLIENT_ID`,
  `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_OAUTH_SCOPES`,
  `SHOPIFY_TEST_SHOP_DOMAIN`
- OIDC / Shop identity: `OIDC_ISSUER`, `OIDC_AUDIENCE`,
  `OIDC_JWKS_URL`, `SHOP_OIDC_USER_ID_CLAIM`
- Model / agent: `META_MODEL_API_KEY`, `META_MODEL_API_BASE_URL`,
  `META_MUSE_MODEL`, `MUSE_TRANSACTION_AGENT_ID`
  (`MUSE_AGENT_ENABLED` stays `false` until controlled validation is
  complete)
- Shop Pay: `SHOP_PAY_API_KEY`, `SHOP_PAY_CHECKOUT_CLIENT`
- Meta: `META_VERIFICATION_WEBHOOK_SECRET`,
  `META_REEL_CALLBACK_SIGNING_SECRET`, `META_ADS_ACCESS_TOKEN`,
  `META_ADS_ACCOUNT_ID`
- Generic execution: `MUSE_GENERIC_ADAPTER_CONFIG_JSON`

Signing secrets are generated fresh (never reused from the old
project); OIDC values come from the identity provider's discovery
document; `MUSE_TRANSACTION_AGENT_ID` comes from Muse agent
registration. See `docs/live-readiness.md` for which rows are
credentials-only, which need an operator client/adapter as well, and
which need an external approval.

### (e) Verify the service after the database and variables exist

- Re-check the public URL: the root response should change from
  `persistent_rate_limit_not_configured`.
- Re-check a health/readiness route and confirm the service no longer
  reports its persistence as unconfigured.
- If the root response does not change, do not claim the API is live:
  re-check the database link and the variables in (d) first.

### (f) Only then proceed to Step 2 of live activation

Step 2 is one real company end to end: profile, adapter, authorized
provider connection, and server-owned manifest, reaching
`TRANSACTION_READY`. That step is not started by this document, and
no real company, provider connection, or transaction is claimed here.

## What is NOT live yet

- No database (see checklist (a)–(c)).
- No real company, provider connection, or manifest.
- No Stripe live credentials or webhook delivery; no real-money
  transaction, and no real-money transaction is approved by this
  document.
- No Meta verification recording channel, Reels distribution approval,
  live Meta ad connection, or Shop backend/identity approval.
- No live transaction, payment, order, shipment, or Shop/Meta
  handling.
- No paid web-service plan (Free plan only, as above).
- No live Shop Pay execution, live Meta ad reporting, or generic
  provider execution: those paths remain credential-gated and
  fail-closed, and Shop Pay, live Meta ads, and generic execution each
  also need an operator client/adapter, not just a credential.
