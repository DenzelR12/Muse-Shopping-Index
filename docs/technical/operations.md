# Deployment and operations

## Deployment topology

The canonical project API is `[deployment endpoint — configure in deployment]`; the separate Muse demonstration service is `[deployment endpoint — configure in deployment]`. These are configured project endpoints, not a current health certification. A duplicate API service, `muse-shopping-index-duplicate-api`, has been identified for eventual retirement after dependency/traffic review.

| Render resource | Identifier |
| --- | --- |
| Canonical API `muse-shopping-index-api` | `[redacted Render resource ID]` |
| Muse demonstration `muse-shopping-index-demo` | `[redacted Render resource ID]` |
| Existing PostgreSQL `muse-shopping-index-db` | `[redacted Render resource ID]` |

These resource identifiers are operational references, not credentials. Retrieve credentials only through the authorized provider's secret/connection interface. The database is in Oregon, matching the services; use its internal URL when attaching it within the appropriate Render network. Do not create a duplicate database to work around an unavailable credential read.

At the last recorded preparation audit, database/identity/model/provider configuration and live validation were incomplete. Browser sign-in interrupted the database attachment attempt; these documents do not establish that `DATABASE_URL` has since been attached. Recheck actual service configuration and deployment before changing readiness claims.

The existing free database was reported to expire November 23, 2026. Confirm its current plan/expiry and arrange durable storage before relying on it beyond that date.

## Build and start

The working monorepo flow installs with the lockfile, builds workspace dependencies and starts the intended package:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @gift-signal/api start
```

For the demo use `pnpm --filter @gift-signal/competition-demo start` after build. Set the service's expected `PORT`/`DEMO_PORT` configuration and verify its bind/health behavior in deployment.

The root Dockerfile is an older partial packaging path: it copies a subset of manifests and the API dist output without the current complete workspace runtime dependency layout. It is not a validated production image for the present monorepo. Do not assume it is interchangeable with the working workspace build; repair and test it before adopting container deployment. Likewise, infrastructure planning documents describe intended WAF/queue/Redis architecture, not proof those resources are deployed.

## Configuration inventory

Use `.env.example` and the owning source for exact semantics/defaults. Store secrets in the deployment secret manager; report presence and validation outcomes, never values.

| Group | Variables / responsibility |
| --- | --- |
| Runtime | `NODE_ENV`, `PORT`, `DEMO_PORT`, `APP_BASE_URL`, `BUSINESS_BASE_URL`, `APP_MODE` |
| Persistence | `DATABASE_URL`; optional subsystem `REDIS_URL` |
| Consumer identity | `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`, `SHOP_OIDC_USER_ID_CLAIM` |
| Exact authority | `DRAFT_SIGNING_SECRET`, `APPROVAL_SIGNING_SECRET`, `AUDIT_HASH_SECRET`, `LINK_AUTHORITY_SIGNING_KEY` |
| Provider security | `AUDIT_SIGNING_SECRET`, `PROVIDER_TOKEN_ENCRYPTION_KEY` or key-ring configuration `PROVIDER_TOKEN_ENCRYPTION_KEYS`, `PROVIDER_OAUTH_STATE_SECRET` |
| Model inference | `META_MODEL_API_KEY`, `META_MODEL_API_BASE_URL`, account-enabled `META_MUSE_MODEL`; timeout/retry configuration |
| Execution gate | `MUSE_AGENT_ENABLED=false` by default; `MUSE_TRANSACTION_AGENT_ID` requires actual company registration/policy |
| Reference payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Reference orders/OAuth | `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_OAUTH_SCOPES`, `PROVIDER_OAUTH_CALLBACK_URL`, `SHOPIFY_WEBHOOK_SECRET`; actual tenant vault credentials |
| Merchant evidence | `MERCHANT_PROVIDER_CREDENTIALS_CONFIGURED`; configuration attestation is not provider verification |
| Company API access | Production credential authority; `GIFT_SIGNAL_API_KEY_HASHES` format is documented in `.env.example`; avoid plaintext production secrets |
| Limits/recovery | `API_RATE_LIMIT_PER_MINUTE`, model timeout/retry settings, `PROVIDER_REFUND_RECOVERY_INTERVAL_MINUTES`, `PROVIDER_REFUND_RECOVERY_STALE_MINUTES`, `PROVIDER_REFUND_RECOVERY_LIMIT` |
| Sandbox attestations | `SHOPIFY_TEST_STORE_CONFIRMED`, `SHOPIFY_TEST_SHOP_DOMAIN`; verify actual selected connection independently |

The API readiness gate currently requires the concrete Stripe/Shopify profile, OIDC/Shop claim, model, persistence, signing/audit, encryption and merchant configuration. Generic core preflight is intentionally company-agnostic; its success does not imply the current API readiness gate or an arbitrary adapter is ready. A new company execution profile needs matching admission and readiness logic.

## Release procedure

1. Run required CI on the exact PR head and review relevant security/transaction changes.
2. Confirm service, branch, commit and environment; merge only when green.
3. Inspect the deployment's final status. Queued/building/update-in-progress is not live.
4. Verify liveness and readiness independently. Demo readiness does not certify API transaction readiness.
5. Audit secret presence and validate actual provider/OIDC permissions without printing credentials.
6. Verify callback/webhook destination, signatures, event delivery and replay behavior in the intended environment.
7. Keep the agent disabled until controlled sandbox evidence exists.
8. Record release commit, deploy IDs, observations, rollback target and remaining gaps.

Do not assume auto-deployment succeeded because GitHub merged. Changes to service environment can trigger a redeploy of an older commit before queued newer deploys; inspect the actual running revision.

## Preflight and model access

```bash
node scripts/hackathon-preflight.mjs
node scripts/hackathon-preflight.mjs --stripe-shopify
node scripts/hackathon-preflight.mjs --remote
```

The core check is the default. Exit code 2 means missing/unsafe configuration; presence is not account verification. A remote timeout is unknown, not ready. Run checks in the service environment to audit its variables; a local empty environment does not reveal hidden Render secrets.

With authorized model access, `--probe-model` makes a synthetic review-only model request, and the held-out live evaluation measures function proposals. These may consume inference credits. Neither proves native connector approval or executes a commerce transaction.

## Monitoring and incidents

| Signal | Interpretation / response |
| --- | --- |
| `/health` fails | Inspect process/build/start/port/deployment logs |
| `/ready` is 503 | Inspect missing gates; configure actual prerequisites, do not bypass them |
| Critical provider observability | Inspect company-scoped operational events and alert state |
| `RECONCILE_REQUIRED` | Query external provider evidence; resolve once with an audit note |
| Stale refund states | Inspect recovery locks/submission references and verified events before retry |
| Event replay/signature error | Verify endpoint/secret/raw body and event identity; do not disable verification |
| Pending authentication | Resume owned stored Checkout; expired/paid sessions must not start a duplicate payment |

API package commands include `alert-check` and `refund-recovery` after build. The API also wires periodic refund recovery when prerequisites exist. Coordinate worker/scheduler ownership and locks; adding an external schedule without checking existing execution is not a recovery strategy. See owning source and [owner-absence operations](../owner-absence-operations.md).

For uncertain payment/order effects, preserve records and stop automatic new attempts. Reconcile using exact company/draft/payment/order evidence. Consumer communication must distinguish payment, order creation, fulfillment and refund finality.

## Rollback and data recovery

Disable agent execution while investigating unsafe behavior; retain audit/webhook processing needed for existing transactions. Roll back to a known compatible application revision only after checking schema and provider side effects. A code rollback cannot undo a payment or order. Do not delete transaction rows, replay records or webhook evidence as a retry mechanism.

Restore testing must include draft/approval compatibility, credential decryption, grant revocation, nonce consumption and reconciliation against provider truth. Runtime additive schema changes currently lack a consolidated reversible migration history. Design operational rollback around those constraints.

## Launch gates still requiring evidence

- Actual OIDC/Shop identity provenance, provider account authority and secret validity.
- Native Meta connector/Reels entry, account linking and trusted human approval callback.
- Real model access and measured held-out evaluation; separate infrastructure if training weights.
- A controlled no-live-money payment/order/webhook test and duplicate prevention proof.
- Company-specific terms, cancellation/refund policies, support and lifecycle coverage.
- Receipt/notification delivery and actual Shop-app visibility where promised.
- Durable database, backup/restore, certificate verification review, observability and incident ownership.
- Security review and safe retirement of duplicate infrastructure after dependency checks.

Follow the [hackathon runbook](../hackathon-launch-runbook.md) for the sandbox sequence. Never infer all-company live support from a universal contract or public-launch readiness from green CI.
