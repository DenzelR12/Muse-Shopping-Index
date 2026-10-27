# Live readiness — credentials-only activation checklist

Goal: after this work, going live should require **only** putting real
credentials and configuration into the deployment secret manager (and,
where noted, an external approval) — no further code changes, no new
adapters written at activation time, no deployment code changes, and no
weakening of any gate. The Nov 3 demo still runs with **no** credentials
at all (Option B: local/demo + CI green only); this document is the
bridge from that demo to a live service, and it must be read before
anyone claims a path is live.

Rules that apply to every row below:

- Secrets go in the deployment secret manager **only**. Never in the
  repo, chat, email, logs, screenshots, or tests. Tests use test-only
  strings and mocked clients; a test passing is never proof that a
  live service works.
- A path with its credential/config **absent** fails closed: a named
  error, no approval consumed, no fake success, no silent fallback
  to another rail, demo data, or a guessed provider.
- A mocked test proves the **code path** (gating, validation,
  tenant trimming, consume-once, watermark behaviour). It does **not**
  prove the live service: only a real credential, a real connection,
  and a real response can prove that. The "Only provable live" column
  says so for each row, explicitly.
- "Credentials in = live path enabled" is true **only** for rows
  marked credentials-only. Rows marked external approval need that
  approval as well — a credential alone does not grant it.

## 1. Always required (every live path)

| Env var / secret | Where | Absent behaviour | Mocked test proves |
|---|---|---|---|
| `DATABASE_URL` (+ Postgres password, from the secret manager; never hard-coded — `compose.yaml` uses `${POSTGRES_PASSWORD}`) | Secret manager | Stores return 503 `*_not_configured`; no silent in-memory fallback in production paths that require durability | Store shape and SQL; **not** real Postgres |
| `DRAFT_SIGNING_SECRET`, `APPROVAL_SIGNING_SECRET`, `AUDIT_SIGNING_SECRET`, `SESSION_SECRET`, `PROVIDER_TOKEN_ENCRYPTION_KEY`, `PROVIDER_OAUTH_STATE_SECRET` | Secret manager | Draft/approval/audit paths return 503 not-configured; nothing is signed with a default | Signing/verification round-trips with test secrets |
| `GIFT_SIGNAL_API_KEYS` / `GIFT_SIGNAL_API_KEY_HASHES` | Secret manager | 401 unauthorized | Auth with test keys |
| `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`, `SHOP_OIDC_USER_ID_CLAIM` | Secret manager / identity provider | Identity verification fails; enrollment and owned status are unavailable | Identity parsing with test claims |
| `MUSE_TRANSACTION_AGENT_ID` | Secret manager / config | `/v1/muse/confirm` and `/v1/muse/agent` return 503 not-configured | Agent-ID presence gating |
| `MUSE_AGENT_ENABLED` | Config, default `false` | `/v1/muse/agent` returns 404 | Disabled-by-default behaviour |
| `PORT`, `APP_BASE_URL`, `PROVIDER_OAUTH_CALLBACK_URL` | Config | Server cannot serve / callbacks cannot complete | — |

Only provable live: a real Postgres database (tables
`company_generic_profiles`, `company_seller_manifests`,
`muse_bi_events`/`muse_bi_watermarks`, provider stores created by the
app with `CREATE TABLE IF NOT EXISTS`), a real OIDC issuer, and a
consumer-enrollment test against a real Postgres (CI provides one via
`ENROLLMENT_TEST_DATABASE_URL`; locally it is skipped without one).

## 2. Credential-gated live paths (code ready, mocked tests pass)

### 2a. Stripe (reference rail — the only live payment rail in code today)

| Env var | Absent behaviour |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Payment intent/checkout paths throw `stripe_secret_required`; webhooks fail signature validation |

Only provable live: a real/sandbox Stripe payment success, a verified
webhook delivery, and a refund/reconciliation run. No real-money
transaction has been evidenced to date.

### 2b. Shop Pay execution — credential-gated client interface

Code: `apps/api/src/shop-pay-vehicle.ts`
(`ShopPayExecutionClient`, `resolveShopPayExecutionConfig`,
`executeShopPayWithClient`) and `muse-confirmation-submit.ts`
(the only path that can execute Shop Pay, because only it holds the
saved Shop Pay authorization reference; the provider execution
service deliberately still blocks direct `shop_pay` calls).

| Env var | Absent behaviour |
|---|---|
| `SHOP_PAY_EXECUTION_ENABLED=true` | `shop_pay_execution_blocked` |
| `SHOP_PAY_API_KEY` (presence only; value never logged) | `shop_pay_execution_blocked` |
| `SHOP_PAY_CHECKOUT_CLIENT` (identifier of the operator's startup-registered client) | `shop_pay_execution_blocked` |
| Startup-registered client absent, config present | `shop_pay_execution_client_not_registered` |

Mocked test proves (`muse-confirmation-submit.test.ts`): a mocked
ready client executes and consumes the approval exactly once; a
client supplied with config not ready is blocked with no consumption;
a client throw consumes nothing (reconcile, never blind retry); drift
and approval/reference mismatch still fail before any client call.

**Honest limit — read this before claiming Shop Pay is
credentials-only:** no Shop Pay API endpoint exists in this repo,
and none was invented. The operator's authorized Shop Pay checkout
client must already exist as their integration and be registered at
server startup (see `live-activation.ts` registries; the API server
itself registers nothing). Credentials + that pre-existing client =
enabled. Credentials alone, with no client, stay blocked. A real
Shop Pay execution is only provable live, with a real checkout
client and a real authorization.

### 2c. Meta business-verification recording — trusted route, disabled without a secret

Code: `POST /v1/provider-readiness/:provider/:externalAccountId/meta-verification`
in `apps/api/src/index.ts`, validation in `live-activation.ts`.

| Env var | Absent behaviour |
|---|---|
| `META_VERIFICATION_WEBHOOK_SECRET` | 410 `meta_verification_recording_disabled` |

The route additionally requires: an authenticated company principal
with `manage_provider_connections`; payload `companyId` equal to
that principal (else 403); header `x-meta-verification-signature`
as `sha256=<hex>` HMAC-SHA256 over the raw body (else 401); and
evidence passing the existing rules — missing, placeholder,
self-attested, future, or expired evidence rejected, and the legacy
flag (when present) must agree with the evidence (else 400 with the
validator's reason). Valid evidence is stored in the
seller-manifest store, which the readiness service reads as its
Meta-evidence fallback. The generic readiness POST stays 410 for
self-attestation; this route does not reopen it.

Mocked test proves (`provider-observability.test.ts`): absent
secret, bad signature, placeholder, expired, self-attested-issuer,
and flag/evidence-mismatch cases are all rejected; a valid signed
record validates.

Only provable live: a real signed Meta webhook recording, and the
company then evaluating to `META_VERIFIED` on that evidence.

### 2d. Native Reel entry — signed callback, disabled without a secret

Code: `POST /v1/muse/reel-entry` in `apps/api/src/index.ts`,
validation in `live-activation.ts`. Like the Stripe/Shopify
webhooks, it sits before the company-principal block because its
authentication is the HMAC signature — and it is safe to do so
because it creates **nothing**: no draft, no approval, no execution,
no state change. It only normalizes a signature-verified intent
(`reelId`, optional `companyId`/`offerId`) for the existing draft
service to use later through its normal authenticated path.

| Env var | Absent behaviour |
|---|---|
| `META_REEL_CALLBACK_SIGNING_SECRET` | 410 `reel_entry_not_configured` |

Bad signature → 401; malformed payload → 400. Mocked test proves
both, plus a valid signed intent normalizing correctly.

### 2e. Live Meta ad ingestion — read-only client interface feeding the BI contract

Code: `ingestMetaAdEvents` in `live-activation.ts`; route
`GET /v1/muse/bi/report|dashboard|export?source=live` in
`apps/api/src/index.ts`.

| Env var | Absent behaviour |
|---|---|
| `META_ADS_ACCESS_TOKEN`, `META_ADS_ACCOUNT_ID` | 503 `muse_bi_live_ads_not_configured` |
| Startup-registered Meta Ads client absent, token present | 503 `muse_bi_live_ads_client_not_registered` |

Ingestion is read-only by contract: the client interface is
`fetchEvents({companyId})` only — it can never change campaigns,
budgets, routing, ranking, or policy. Events are validated with
`parseSuppliedBiEvents` (acquisition stamped at creation, campaign
present = paid), tenant-trimmed to the requesting company **before**
recording (other-tenant events are dropped and counted), and the
watermark advances only on verified success (`applyBiIngestionResult`);
on failure it is not advanced and output is stale (prior artifact)
or unverifiable (none). A live report is labeled `LIVE AD INGESTION`
via an explicit `sourceLabel` override; the default report label
stays `DEMO/SUPPLIED EVENTS`, so demo data can never be relabeled
live by accident. With `DATABASE_URL` set, ingested events persist
in `muse_bi_events`/`muse_bi_watermarks`; without it they are
process-local (in-memory store), which must be stated if that
deployment is ever presented.

Mocked test proves (`provider-observability.test.ts`): tenant
trimming, watermark advance on success, and no watermark advance on
failure.

**Honest limit:** no Meta Graph API call exists in this repo, and
none was invented. The operator's authorized advertising client
must already exist and be startup-registered. Token + client =
enabled; token alone stays 503.

### 2f. Generic provider execution — startup config, never over HTTP

Code: `apps/api/src/muse-generic-profile.ts` (registry),
`parseGenericAdapterConfig` in `live-activation.ts`.

| Env var | Absent behaviour |
|---|---|
| `MUSE_GENERIC_ADAPTER_CONFIG_JSON` — JSON object mapping `companyId` → `adapterId` | No config; a registered profile without an adapter still fails closed |
| Startup-registered adapter for that company absent | `muse_generic_connector_not_registered` at submit, no approval consumed |

The config declares **which** operator adapter serves **which**
company; it does not create an adapter, and adapters are never
registered over HTTP or from a request body. The synthetic fixture
companyId (`synthetic-fixture-demo-only`) is rejected by the config
parser, by profile registration, and must never be registered as an
adapter for a real company. A company registers its own profile via
`POST /v1/muse/generic-profiles` (companyId must equal
`principal.orgId`, placeholder evidence rejected); registration
alone does not execute.

**Honest limit:** generic execution is "credentials + config +
operator adapter", not credentials alone. The operator's adapter is
their pre-existing provider integration, registered at startup.
Without it, a profile is registered but execution stays blocked —
by design, not by omission.

### 2g. Meta model / Muse agent

| Env var | Absent behaviour |
|---|---|
| `META_MODEL_API_KEY`, `META_MODEL_API_BASE_URL`, `META_MUSE_MODEL` | `/v1/muse/agent` returns 503 `muse_not_configured` |

Only provable live: a real model response for the configured model.
To date the saved key returned a zero-entry catalog and 404
`model_not_found` for `muse-spark-1.3`; do not claim the key is
invalid or the model globally unavailable from that alone, and do
not run repeated paid inference probes without a config/access
change.

## 3. External approvals — NOT credentials, still required for live

These are decisions by another party. No env var grants them, and
no code in this repo can substitute for them:

1. **Meta Reels distribution approval** — Meta actually sending
   Reel intents to `POST /v1/muse/reel-entry`. The route is ready
   and signed; distribution is Meta's decision.
2. **Meta verification channel acceptance** — Meta accepting and
   sending verification evidence to the recording route above.
   Recording code is ready; acceptance is Meta's decision.
3. **Shop partnership / Shop backend handling** — Shop owning
   notifications, verification, receipt email, and shipping for
   real merchant orders, plus Shop consumer identity (OIDC) and
   Shop Pay execution credentials (see 2b). No live Shop handling
   has been evidenced for any merchant.
4. **Authorized company/provider connections** — each real company
   authorizing its provider connection (OAuth/API) with the exact
   capabilities granted, plus its catalog, pricing, availability,
   ordering, and fulfillment wired through an operator adapter.
   Without a live connection, draft creation fails closed
   (502/404/409), never with a fake quote.
5. **Stripe live/test credentials and webhooks** — see 2a; a
   sandbox success is the first live evidence, not a code claim.

## 4. Activation order (when the operator is ready)

1. Put §1 secrets into the secret manager. Confirm the server log
   line `live_activation_config_present` shows presence booleans
   only (no values) and that the demo still runs with no live
   credentials.
2. Set up real Postgres; confirm the tables above are created by
   the app on first use; run the consumer-enrollment test against
   it (CI provides `ENROLLMENT_TEST_DATABASE_URL`).
3. Register one real company end to end, in this order: profile →
   adapter (startup) → provider connection → seller manifest
   (display name, titles, terms, timing, ETA) → Meta verification
   (if Meta-origin) → readiness `TRANSACTION_READY`.
4. Enable one payment vehicle for that company (Stripe first;
   Shop Pay only with 2b complete), run a no-money confirmation
   against the running server, then a sandbox payment, then —
   only with an explicit approval of that exact transaction — a
   real one. Every step's evidence (route response, order record,
   tracking, refund path) is recorded before the next step.
5. Enable live ad ingestion (2e) only after the advertising
   connection is authorized; confirm the live report label and
   tenant trimming with two companies' events before presenting
   any number as live.
6. Re-check: server log shows no secret values; no credential
   appears in the repo, chat, or logs; the demo walkthrough still
   passes under Option B; CI for the new HEAD is checked in the
   live browser before any green claim is made for it.

## 5. What is NOT live after this work (do not claim it)

- Live Shop handling, live Meta ad reporting, live Shop Pay
  execution, live payment/order/shipment — all require §2/§3 items
  above, not just this code.
- Real Postgres verification, real-browser confirmation-page run
  against a running server, consumer enrollment against a real
  Postgres — all still unverified locally; CI provides Postgres
  for its inventory, which is not the same as a live deployment.
- Full internal rebrand — intentionally not renamed (see the
  finish-all rebrand audit): `GIFT_SIGNAL_API_KEYS` is an operator
  contract, `gift-signal:` Stripe idempotency prefixes must never
  change, and the package scope is workspace-private.
- Workflow coverage for `muse-seller-display.test.ts` and
  `provider-oauth.test.mjs`, and the binary editorial image —
  user-only steps (see the demo walkthrough's remaining list).
