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
