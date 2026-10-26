# Zero-Trust Production Model

## Principle

Every model, agent, connector caller, retrieved document, ad payload, and external provider response is untrusted until independently verified.

A model may:
- interpret intent
- select candidate tools
- explain evidence
- request an action

A model may not be authoritative for:
- identity
- permissions
- connection grants
- credentials
- price
- inventory
- transaction draft integrity
- approval
- payment state
- fulfillment state
- policy exceptions
- deployment permissions

## Transaction chain

1. Caller supplies opaque connection ID.
2. Server resolves the connection and permissions from durable storage.
3. Provider returns live state.
4. Server creates and signs an immutable draft.
5. Human-facing UI displays that exact draft hash.
6. Trusted identity provider authenticates the consumer.
7. Approval issuer signs a short-lived token bound to:
   - subject
   - company
   - connection
   - draft ID
   - draft hash
   - exact amount
   - currency
   - action
   - expiration
8. Execution resolves the draft again server-side.
9. Provider revalidation runs.
10. Any state change invalidates the prior approval and forces reapproval.
11. Approval token is consumed once.
12. Draft execution is atomically claimed once.
13. Provider commit must be idempotent.
14. Signed provider webhook advances durable transaction state.
15. Provider webhook/event ID is consumed once.

## Replay boundaries

The zero-trust replay store covers:
- approvals
- Stripe webhook IDs
- Shopify webhook IDs
- signed links
- other future provider callbacks

Production implementations use durable storage. In-memory implementations exist only for tests/local development.

## Secrets

Production:
- plaintext org API credentials are rejected
- API credentials are represented by credential ID + SHA-256 hash + scopes
- model-facing tool schemas never include connector credential references
- signing keys remain server-side
- provider secrets remain in the deployment secret manager
- logs and readiness endpoints never return secret values

## Model-compromise assumption

Assume the active model is malicious or prompt-injected.

A compromised model should be able to:
- ask for disallowed operations
- submit incorrect IDs
- replay old tokens
- modify visible draft data

Those attempts must fail because the model cannot:
- mint valid approval signatures
- change server-side grants
- change signed draft hashes
- reuse a consumed approval
- bypass provider revalidation
- mark a payment paid
- advance fulfillment from an unsigned event
- widen its own API capabilities

## Infrastructure assumptions

Production readiness must fail unless:
- Postgres/durable state is configured
- shared replay/rate-limit storage is configured
- Muse credentials are configured
- payment credentials are configured
- draft and approval signing secrets are configured
- hashed API credentials are configured
- a trusted identity provider is configured

## Repository governance

Security-sensitive code is covered by CODEOWNERS. Repository settings should additionally enforce:
- protected main branch
- required passing CI
- required CODEOWNER review
- no force-push
- no branch deletion
- signed/reviewed production release promotion
- secret scanning and push protection where available

Repository configuration outside code must be enabled in GitHub settings if the connector cannot enforce it programmatically.

## Production cutover gates

Do not enable real-money autonomous execution until all are true:

- [ ] durable connection authority
- [ ] durable signed draft store
- [ ] durable replay store
- [ ] trusted identity provider
- [ ] short-lived exact approval tokens
- [ ] mandatory provider revalidation
- [ ] idempotent provider commit
- [ ] verified one-time payment webhooks
- [ ] verified one-time fulfillment webhooks
- [ ] hashed/rotatable API credentials
- [ ] managed secrets
- [ ] shared rate limiting
- [ ] immutable audit trail
- [ ] monitoring/alerting
- [ ] backup/restore validation
- [ ] rollback procedure
- [ ] protected main/release workflow
- [ ] provider sandbox test
- [ ] live Muse test
- [ ] payment test-mode end-to-end test
