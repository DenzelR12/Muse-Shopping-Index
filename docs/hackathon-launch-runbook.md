# Muse hackathon preparation and launch runbook

## Universal company scope

MUSE SHOPPING INDEX connects authorized companies through a common contract. Retail,
travel, tickets, services, reservations and digital goods share identity, exact
approval and replay/recovery rules. Each company supplies its own authorized
search, pricing, execution, status and policy adapter. Shopify and Stripe are one
reference transaction profile, not admission requirements for every company.
The environment preflight defaults to universal core checks; `--stripe-shopify`
adds only that adapter’s sandbox requirements. A configured core is not proof that
an arbitrary company adapter is connected or production-ready. See the
[company adapter contract](company-adapter-contract.md).

## What is ready to rehearse

The model-facing commerce tools, authenticated signed-draft continuation, exact
Buy binding, saved-payment enrollment challenge, payment/order orchestration,
buyer-owned status/tracking, refund finality and failure recovery tests exist.
There is no storefront requirement for this demonstration.

Do not confuse three distinct results:

| Evidence | What it proves | What it does not prove |
| --- | --- | --- |
| Offline rehearsal | Existing modules obey approval, ownership and recovery rules with mocked transports | Live Muse reasoning, live payment or merchant fulfillment |
| Live model probe/evaluation | Account/model/tool-calling access and measured model action accuracy | Native Meta distribution or transaction success |
| Controlled sandbox transaction | The configured identity/payment/order/webhook path works end to end | Public launch readiness or production fulfillment |

## Tonight: repeatable no-money rehearsal

```bash
pnpm install --frozen-lockfile
pnpm build
node scripts/build-muse-commerce-training.mjs --check
node scripts/rehearse-muse.mjs
```

The rehearsal clears live model/provider/database credentials in its child process
and blocks default fetch transports. Explicit test transports remain mocked. It
does not train weights, charge a card, create a merchant order or send emails.
The PostgreSQL integration case is skipped offline; CI runs it separately against
its dedicated database service. A skipped database test is not a passing database test.

The rehearsal includes native tool calls, signed Buy validation, landed-total drift,
cross-consumer rejection, enrollment replay/expiry, payment authentication fallback,
fallback retry, order-response loss, reconciliation and refund webhook finality.

## Audit configuration without printing secrets

Run these in the environment that holds the API service's actual configuration:

```bash
node scripts/hackathon-preflight.mjs
node scripts/hackathon-preflight.mjs --model-only
node scripts/hackathon-preflight.mjs --stripe-shopify
node scripts/hackathon-preflight.mjs --remote
```

Exit code 2 means missing/unsafe configuration. The report prints variable names,
presence/shape checks and public readiness, never secret values. A remote timeout
means the service could not be checked; it is not evidence of readiness. The local
configuration report describes the current process, not Render's hidden variables.

The native host runs on the canonical API service. Configure its actual account-enabled
`META_MUSE_MODEL`, `META_MODEL_API_KEY` and `META_MODEL_API_BASE_URL` there. A separate
Muse demo service needs its own model configuration if it also calls the model.
Keep `MUSE_AGENT_ENABLED=false` while checking model access.

Use the checked-in `.env.example` to locate remaining names. Never paste secrets
into a prompt, repository, screenshot or demo transcript. Presence checks do not
verify credentials, OAuth state, provider permissions, webhook delivery or Shop identity.

## Tomorrow: read-only live model probe

After Meta grants account/model access and the model variables are configured:

```bash
node scripts/hackathon-preflight.mjs --probe-model
node scripts/evaluate-muse-commerce.mjs --live --native
```

The probe allows only a synthetic `present_review` tool result. The evaluation uses
held-out synthetic cases. Both make real model requests and can consume model
credits; neither invokes commerce APIs or payments. Record the actual model ID,
commit, returned tool calls, pass/fail counts and failures. Do not count mocked or
deterministic outputs as live model success.

## Controlled transaction validation

For the current Stripe/Shopify reference adapter, use a dedicated Stripe sandbox/test key and a verified Shopify development/test
store that cannot dispatch real customer fulfillment. `SHOPIFY_TEST_STORE_CONFIRMED`
and `SHOPIFY_TEST_SHOP_DOMAIN` are operator attestations for preflight, not proof
that the selected provider connection is a test store. Verify the actual connection
and selected merchant before enabling any test execution.

Keep test and production credentials separate. Configure real test-consumer OIDC,
the trusted Shop identity claim, subject-bound SetupIntent enrollment, verified
provider connections/readiness, agent policy, and signed exact review. Register
test Stripe/Shopify webhooks against the intended environment and verify delivery.

Then, only for that controlled environment, enable the agent and approve one exact
test purchase. Capture each boundary: review, one Buy proof, direct payment result,
verified webhook, one Shopify test order, buyer-owned status and tracking state.
Confirm a repeated request does not repeat payment or order creation. Do not infer
receipt delivery or Shop-app visibility from a successful API response alone.

Replay the failure matrix: payment authentication, fallback resume in a new request,
expired/paid checkout, lost Shopify response, approval/webhook replay, payment
rotation, changed total, wrong buyer, expired proof, and refund failure/recovery.

For other companies, use their own provider sandbox, capability grants, live quote,
transaction record, webhook/status evidence and cancellation/refund policies.
Never substitute a Shopify order for a company that fulfills through another API.

## Native Meta/Muse onboarding package

`docs/muse-connector.openapi.json` documents the deployed continuation and status
routes as an onboarding draft. Its project risk annotations are documentation,
not a claim of platform registration or approval. The continuation can transact
and must be classified as a sensitive write, even when it first returns a review.

Approval issuance is deliberately absent from model-visible tools. The actual Meta
human confirmation/account-linking integration must supply trusted proof through
the authorized host. A model saying "approved" is never sufficient. Do not expose
the approval-issuance API as a tool that lets the model approve its own purchase.

Meta's public guidance describes account linking, endpoint onboarding and review.
Confirm the exact available integration interface in the account's developer tools.
Hackathon model access does not establish native connector approval. The actual
Reel-to-Muse entry point and trusted human-confirmation callback still need that
platform integration; this repository cannot fabricate the platform permission.

Prepare the real business verification, brand assets, privacy/product terms,
support/security contacts and a dedicated reviewer test account. Include seller
refund/cancellation terms and a support route in the exact review before submitting
the purchasing tool for platform approval. Do not invent policies or contacts.
Synthetic training examples stay synthetic: do not export connector user data
into training sets.

Official references:

- [Hackathon brief](https://cerebralvalley.ai/e/meta-ai-developer-hackathon)
- [Meta AI connector onboarding](https://dev.meta.ai/products/connectors)
- [Muse connector guidelines](https://platform.muse.ai/docs)
- [Native tool calling](https://dev.meta.ai/docs/cookbook/tool-function-calling)

## Judge demonstration

1. Show Reel context and product resolution from a clearly labeled source.
2. Show the exact consolidated review and saved-payment label.
3. Show that no Buy proof means no purchase execution.
4. In the controlled test environment, approve once and show verified payment/order evidence.
5. Inject an uncertain response and show status/reconciliation instead of another charge.
6. Show buyer-owned tracking/refund state and the measured live model evaluation.

If model access is unavailable, demonstrate the offline rehearsal and label it as
such. Do not call a pending checkout a completed order, synthetic success a live
result, or illustrative click counts a measured conversion improvement.

## Remaining external or integration evidence

- Actual Meta account/model access and live evaluation result.
- Native connector/Reels entry, account linking and trusted approval callback.
- Real merchant policies, reviewer test account and platform review acceptance.
- Controlled Stripe/Shopify test transaction and verified webhook/receipt delivery.
- Shop consumer-app visibility confirmed using the actual customer/order relationship.
- Separate authorized model-training infrastructure if weight tuning is pursued.
- Public-launch security/operations review and any duplicate Render service retirement.

These are not completed by green CI or by this runbook. Keep the agent disabled
outside the verified test environment until the corresponding evidence exists.


## Existing Render database connection

The project database already exists: `muse-shopping-index-prod-db`
(`[redacted Render resource ID]`, Oregon, same workspace as the API).
The canonical API’s public readiness reported no `DATABASE_URL` during the audit.
Use its [Connect panel — configure in deployment]
to securely attach the **internal** connection URL to the canonical API service.
The connected database metadata tools do not expose that credential URL; do not
guess it or create a duplicate database. This free instance reports an expiry
date of November 23, 2026; arrange durable storage before relying on it beyond that.

## Diagnosing a failed model probe

`MODEL_UNAVAILABLE` is not proof that the API key is invalid. The probe now emits
only an allowlisted `modelDiagnostic` category and, for HTTP errors, numeric
`httpStatus`. It never emits upstream bodies/headers, exception messages or keys.

| Category | Next check |
| --- | --- |
| `AUTHENTICATION_FAILED` (401) | Correct project key, validity and authorization format |
| `ACCESS_DENIED` (403) | Project/model permissions and account access |
| `ENDPOINT_OR_MODEL_NOT_FOUND` (404) | Configured base endpoint and account-enabled model ID |
| `RATE_LIMITED` (429) | Account quota/rate limits; avoid repeated automatic probes |
| `UPSTREAM_ERROR` (5xx) | Provider availability; preserve safe failure evidence |
| `REQUEST_REJECTED` (other non-success) | Request compatibility; inspect provider documentation |
| `TIMEOUT` / `NETWORK_ERROR` | Service egress, deadline and endpoint connectivity |
| `INVALID_RESPONSE` | Response is not a valid Chat Completions message envelope |

A category narrows diagnosis; it does not establish a root cause. A failed probe
never dispatches commerce tools. Keep execution disabled until actual model and
controlled sandbox validation succeed. The normal production build must not
permanently depend on a live paid model probe.
