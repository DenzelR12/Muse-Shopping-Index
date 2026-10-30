# Universal company adapter contract

MUSE SHOPPING INDEX is an authorization and orchestration layer for any company that
exposes an authorized API or connector. It is not a Shopify-only store or a
requirement that every company move its commerce onto Shopify or Stripe.

The existing `CompanyConnectorAdapter` contract provides search, draft and execute;
`ZeroTrustConnectorAdapter` adds live revalidation and an idempotent-commit promise.
`ZeroTrustConnectorRegistry` binds each adapter to its company manifest, while
`ZeroTrustConnectorRuntime` checks customer grants, signed drafts, exact approval
and replay protection. These are separate from the concrete Stripe/Shopify
transaction implementation in the current authenticated Muse continuation.

| Shared platform behavior | Company-specific implementation |
| --- | --- |
| Authenticated consumer and company scope | Company account linking and delegated permissions |
| Resolve an offering | Inventory, room/rate, ticket, appointment, service or digital catalog |
| One batch of missing details | Variant, dates, guests, seats, location or service configuration |
| Exact signed review | Full price, currency, fees/taxes, payment timing and refund/cancellation terms |
| Explicit approval for each consequential action | Purchase, booking or other supported company transaction |
| Idempotent execution and verified finality | Provider payment/booking/order APIs and webhook/status evidence |
| Recovery and post-purchase ownership | The company's status, changes, cancellations, returns and refund APIs |

A company advertises only capabilities it actually implements and has permission
to expose. An inventory-only connection cannot be presented as a purchasing
integration. A confirmed booking or digital delivery does not need a parcel
tracking number; a shipped order must not be described as delivered without
fulfillment evidence. Every tenant remains isolated by server-owned company,
connection, subject and draft bindings.

Adapter admission requires real authorization, business verification where
required, live pricing/availability, exact terms, idempotency, safe uncertainty
handling, auditing and whatever lifecycle actions the capability promises. A
flag or model statement is not evidence that those requirements are satisfied.

The current production continuation and payment sandbox runbook exercise the
Stripe/Shopify reference adapter. Other company APIs must register their own
implementation and pass the same contract/approval tests. The model policy and
synthetic curriculum now include retail, travel, tickets, services, reservations
and digital transactions; that does not imply those companies are live-connected.

Run `node scripts/hackathon-preflight.mjs` for shared core configuration. Add
`--stripe-shopify` only when auditing that particular reference adapter. Do not add
Shopify credentials to another company's integration merely to make a readiness
report green. Each company's credentials stay in the tenant vault/server secret
store, never in prompts or shared client configuration.

## Meta business-verification gate (Meta-origin businesses only)

Business origin is a server-owned enrollment fact on
`BusinessReadinessEvidence.origin` (`'meta'` or `'non-meta'`), never inferred
from a model statement, a browser payload, or a provider display name. An
omitted or unknown origin fails closed to the Meta-origin path; callers must
explicitly set `origin:'non-meta'` to use the non-Meta path.

Meta-origin businesses walk this ladder, derived by
`deriveBusinessReadiness` in `services/mcp-gateway/src/business-connectors.ts`:

`CONNECTED` → `META_VERIFIED` → `CATALOG_VERIFIED` → `TRANSACTION_READY` → `AUTONOMOUS_READY`

- `CONNECTED`: connector and identity gates, or Meta verification, not yet
  satisfied. A Meta-origin business without confirmed verification evidence
  stays here; it never advances on a bare flag.
- `META_VERIFIED`: Meta verification confirmed, catalog not yet validated.
- `CATALOG_VERIFIED`: catalog validated, but a transaction gate (live
  inventory, live pricing, transaction action, webhook events, idempotency,
  provider revalidation) is still missing.
- `TRANSACTION_READY` / `AUTONOMOUS_READY`: all transaction gates, and for
  autonomous, agent policy, audit trail, recovery actions and fulfillment
  status, are satisfied.

Non-Meta-origin businesses keep their existing path unchanged:

`CONNECTED` → `VERIFIED` → `TRANSACTION_READY` → `AUTONOMOUS_READY`

Meta verification is neither required nor consulted for them, and their
capability manifests report `metaBusinessRequired:false` (Meta-origin and
origin-omitted manifests report `true`).

### Evidence field

Meta-origin verification is carried as `metaVerification` on the readiness
evidence:

```ts
{
  verified: true,                    // must be exactly true
  verifiedAt: '2026-10-24T13:00:00.000Z', // valid ISO timestamp, not in the future
  evidenceRef: 'meta-evidence-001',  // non-empty, non-placeholder server record reference
  issuer: 'meta-business-record',    // authority that issued the verification
  source: 'server-recorded',         // server-side recording channel
  expiresAt: '2027-01-01T00:00:00.000Z' // optional; if present and past, the evidence is expired
}
```

`validateMetaBusinessVerification` rejects self-attested evidence
(`issuer`/`source` of `self`, `self-attested`, `model`, `browser`, or similar),
missing or placeholder `evidenceRef`, an invalid or future `verifiedAt`, and
expired evidence. The legacy `metaBusinessVerified` flag must also be `true`:
for Meta-origin businesses, a flag without an evidence record and an evidence
record without the flag both fail closed to `CONNECTED`.

This is evidence-recorded verification, not a live Meta API verification:
no Meta API call is made or claimed here. The evidence must be supplied and
recorded server-side and validated by the functions above; it is never taken
from model output or browser JSON alone, and a flag or model statement is not
evidence.

### Fail-closed gates

A Meta-origin business that lacks valid verification cannot become
`TRANSACTION_READY`, so every gate that checks transaction readiness fails
closed for it automatically: its capability manifest reports
`purchase:false` (and likewise for reserve, cancel, refund and gift), and the
generic and reference readiness paths that admit only `TRANSACTION_READY` or
`AUTONOMOUS_READY` businesses exclude it. `assertBusinessTransactionReady`
gives the explicit error instead of a degraded approval:
`meta_business_verification_required` when Meta verification is the missing
piece, `business_not_transaction_ready` otherwise. It never approves a
transaction at a lower stage.

The API reference path threads the same gate through
`apps/api/src/provider-readiness.ts` (`origin` and `metaVerification` on
`ProviderVerificationEvidence`) and `ProviderReadinessService.evaluate`
(`origin` / `metaVerification` arguments). Known gap: the Postgres readiness
store (`apps/api/src/provider-readiness-store.ts`) still persists only the
legacy `metaBusinessVerified` flag, not `origin` or `metaVerification`, so a
Meta-origin business evaluated through the service without evidence supplied
at evaluation time fails closed to `CONNECTED` until that store gains those
fields. The two `providerReadiness.evaluate` call sites in
`apps/api/src/index.ts` (the reference Muse host `businessReady` check and
the `GET /v1/provider-readiness/...` endpoint) currently pass no origin, so
they fail closed to the Meta path as well: a business that previously
reached `TRANSACTION_READY` or `AUTONOMOUS_READY` on the legacy flag alone
now evaluates to `CONNECTED` until its origin is recorded (as `'non-meta'`
when it genuinely is not Meta-origin) or its Meta verification evidence is
supplied. That is the gate working as intended, not a bypass. There is also
currently no API route that records `metaVerification` — `POST
/v1/provider-readiness/...` returns `410
provider_readiness_self_attestation_disabled` — so recording evidence is a
separate, server-side follow-up, not something a caller can self-assert
through the API. No live Meta, live Shop or live payment claim follows
from this gate.
