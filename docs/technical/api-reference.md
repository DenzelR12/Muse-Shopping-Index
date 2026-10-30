# HTTP API and tool reference

Implementation authority: `apps/api/src/index.ts` and the request validators/services it invokes. This reference inventories the API; it is not a replacement for executable schemas. The [connector OpenAPI draft](../platform/muse-connector.openapi.json) intentionally covers only selected Muse routes and is not a complete public API specification or evidence of native Meta registration.

## Authentication and transport

Use HTTPS outside local development. JSON routes use `Content-Type: application/json`. Human routes require `Authorization: Bearer <OIDC identity token>` with configured issuer, audience, JWKS and recent authentication. Company routes use the project's API credential authority, capability checks and principal-derived company scope. A company credential is not a substitute for a consumer identity token.

Webhook routes verify raw request signatures rather than consumer tokens. The OAuth callback validates server-owned state and code. Public diagnostics do not grant transaction authority. Request IDs and rate-limit headers are emitted by the HTTP layer where applicable; retain safe correlation IDs for support without logging tokens or payment credentials.

## Public and event routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Process liveness; not commerce readiness |
| GET | `/ready` | Production configuration gates; 503 when not ready |
| GET | `/v1/onboarding/status` | Onboarding configuration status |
| GET | `/v1/providers` | Declared provider connection plans; not proof of live accounts |
| GET | `/v1/provider-oauth/callback` | OAuth completion using `state` and `code` |
| POST | `/v1/webhooks/stripe` | Raw body and `stripe-signature`; verified payment/refund events |
| POST | `/v1/webhooks/shopify` | Raw body, HMAC/topic/shop/event headers; verified provider events |

## Consumer routes

| Method | Path | Request and behavior |
| --- | --- | --- |
| POST | `/v1/consumer-commerce/enrollment/start` | Strict empty JSON object; returns 201 with challenge ID and client secret |
| POST | `/v1/consumer-commerce/enrollment/complete` | Only `enrollmentId`; verifies stored SetupIntent and atomically consumes challenge; 201 |
| POST | `/v1/consumer-commerce/enroll` | Retired insecure direct flow; 410 |
| POST | `/v1/approvals/issue` | Generic explicit human approval for exact displayed draft |
| POST | `/v1/muse/approvals/issue` | Same review proof plus server-resolved saved payment binding |
| POST | `/v1/muse/agent` | Native model continuation from existing owned signed draft; 404 while disabled |
| POST | `/v1/muse/confirm` | Existing explicit approval proof; invokes independent server transaction verifier; 201 |
| GET | `/v1/muse/orders/:draftId` | Buyer-owned persisted status and server-read fulfillment/tracking; 404 for unowned/missing order |

### Enrollment payloads

```json
{}
```

Start response shape:

```json
{"enrollmentId":"<challenge UUID>","clientSecret":"<Stripe setup client secret>"}
```

Complete request and response:

```json
{"enrollmentId":"<challenge UUID>"}
```

```json
{"enrolled":true,"paymentRail":"stripe","shopIdentityVerified":true}
```

The client secret belongs only in the authorized Stripe confirmation context. Do not log it or send it to the model. Do not send customer/payment-method/SetupIntent IDs to completion.

### Approval and confirmation

Approval request to the appropriate issuer route:

```json
{
  "connectionId":"<owned connection>",
  "draftId":"<server draft>",
  "displayedDraftHash":"<exact 64-character hexadecimal draft hash>",
  "approved":true
}
```

The hash and displayed review come from the server envelope. A client must never calculate approval from a different mutable cart or treat this illustrative payload as consent. Successful issuance returns `approvalToken`, `draftId`, `connectionId` and `expiresInSeconds` (600). Keep the token outside logs and model transcripts.

`/v1/muse/confirm` accepts `connectionId`, `draftId` and the actual `approvalToken`. The identity and receipt email are resolved server-side. The returned `checkout` may indicate direct execution or trusted payment authentication; a response is not final order evidence.

### Native model continuation

```json
{
  "connectionId":"<owned connection>",
  "draftId":"<existing signed draft>",
  "message":"Show the current review or transaction status."
}
```

Only these keys and an optional existing `approvalToken` are allowed. IDs are nonempty strings up to 160 characters; message up to 4,000; optional token up to 8,192. Client-selected subject/company, email, payment identifiers, model configuration and trusted server context are rejected.

The response combines the bounded runner result with consumer `events`. Exact review/order/authentication data is separated from public model status. No approval means review/wait, not execution. The host verifies ownership before consuming model credits. Production confirmation and agent routes also require the current reference-profile readiness gate.

### Order response interpretation

Fields include `draftId`, `state`, `amount`, `currency`, `paymentStatus`, `orderStatus`, `trackingStatus`, optional `providerOrderId` and normalized `order`. No provider credentials are returned. `trackingStatus` is `PENDING`, `AVAILABLE` or `UNAVAILABLE`. Read [lifecycle semantics](transaction-lifecycle.md) before presenting paid/refund/tracking projections to consumers.

## Company/operator routes

Company is derived from the authenticated principal. Provider and external-account identifiers in paths are normalized and checked against server records.

| Method | Path | Required capability / purpose |
| --- | --- | --- |
| GET | `/v1/provider-orders/:provider/:externalAccountId` | `manage_provider_connections`; order read, limit 1–50 |
| POST | `/v1/provider-oauth/start` | `manage_provider_connections`; begin authorized connection |
| POST | `/v1/provider-credentials/rekey-batch` | `admin_override`; credential-key migration |
| POST | `/v1/provider-runtime/:provider/:externalAccountId/:operation` | Runtime refresh/sync/rekey/revoke; operation-specific capability checks |
| GET | `/v1/provider-connections` | `manage_provider_connections`; company connection summaries |
| POST | `/v1/provider-connections` | `admin_override`; validated declared capabilities; not proof of OAuth success |
| GET | `/v1/provider-observability` | `admin_override`; operational summary; critical level can return 503 |
| POST | `/v1/provider-transaction-drafts` | `request_payment`; server-built exact provider transaction draft |
| POST | `/v1/provider-checkout/:provider/:externalAccountId` | `request_payment`; signed draft, approval and live revalidation |
| PUT / DELETE | `/v1/provider-agents/:agentId` | `admin_override`; authorize/revoke agent |
| GET | `/v1/provider-agent-policy/:provider/:externalAccountId` | `manage_provider_connections`; read policy |
| PUT | `/v1/provider-agent-policy/:provider/:externalAccountId` | `admin_override`; registered allowed agents, amount/currency limits |
| GET | `/v1/provider-readiness/:provider/:externalAccountId` | `manage_provider_connections`; trusted evidence and evaluated manifest |
| POST | `/v1/provider-readiness/:provider/:externalAccountId` | Disabled self-attestation; 410 |
| GET | `/v1/provider-transactions/reconcile` | `admin_override`; unresolved transactions, limit 1–100 |
| POST | `/v1/provider-transactions/:draftId/reconcile` | `admin_override`; evidenced `CONFIRM_ORDER` or `NO_ORDER`, required note |
| GET | `/v1/provider-transactions/refunds` | `admin_override`; compensation worklist, limit 1–100 |
| POST | `/v1/provider-transactions/:draftId/refund` | `admin_override`; guarded compensation submission |
| POST | `/v1/gifts/recommend` | `recommend_gifts`; verified gifting recommendations |
| POST | `/v1/bundles/build` | `build_bundle`; bundle composition |
| POST | `/v1/bundles/interactions` | `record_telemetry`; interaction telemetry |

Legacy connection mutation suffixes `sync-success`, `sync-error` and `revoke` under `/v1/provider-connections/...` return 410 and direct callers to the runtime route. Reporting success manually is not provider evidence. Exact company route request schemas remain in the implementation; do not supply arbitrary raw payment payloads instead of signed drafts.

## Errors and retry rules

Responses generally contain an `error` code. Error mappings are route-specific; do not assume every conflict shares one status.

| Status | Interpretation |
| --- | --- |
| 400 | Invalid payload, malformed identifiers or invalid webhook evidence |
| 401 | Missing/invalid identity/API credential or required reauthentication |
| 403 | Authenticated principal lacks required capability |
| 404 | Missing/unowned resource or disabled native agent endpoint |
| 409 | State/binding conflict, expired/replayed approval, enrollment requirement or missing trusted Shop claim |
| 410 | Retired endpoint or disabled self-attestation |
| 429 | Rate limit reached; respect reset information |
| 502 | Some provider execution/upstream failures |
| 503 | Missing critical configuration, readiness gate or unavailable required store |

For enrollment specifically, missing Shop claim and incomplete/mismatched enrollment are application conflicts, not generic authentication failures. Do not retry mutations blindly after timeout/5xx: query persisted state and resolve uncertainty. Reapproval is required after material quote/payment changes. Never use retries to bypass expiry or replay protection.

## MCP and model tools

`services/mcp-gateway/src/business-connector-server.ts` registers:

| MCP tool | Authority boundary |
| --- | --- |
| `search_company_offers` | Company/opaque connection lookup and read-only search |
| `create_company_action_draft` | PURCHASE/BOOKING draft from offer IDs and configuration |
| `execute_company_action` | Stored signed draft, exact one-time approval and provider revalidation |

Tool arguments containing company/connection IDs are lookup inputs, not proof of permission. Tool annotations describe intended behavior; runtime checks enforce it. The broader business MCP server is documented in the [gateway README](../../services/mcp-gateway/README.md).

Muse's native function names and policy include resolution, connection/enrollment requests, details, review/reapproval, approved execution, trusted authentication, order/refund reads and reconciliation. See the [model action contract](../research/muse-model-training.md) and `apps/demo/src/muse-tool-agent.ts`. The model never selects arbitrary checkout URLs or grants itself approval.
