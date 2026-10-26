# Security model

MUSE SHOPPING INDEX separates **reasoning**, **authority**, and **transaction commit**.

## Trust boundaries

- Muse or any other model may interpret intent and choose among tools.
- Models do not own inventory, price, identity, payment or booking authority.
- Company connectors return evidence-backed live/demo offers.
- The Shopping Intelligence Index ranks only the evidence it receives.
- Read, draft and commit actions are separate capabilities.
- Commit actions require explicit user approval.
- Provider systems revalidate price, availability and configuration before commit.
- Secrets are referenced server-side and never placed into model prompts.

## Payments

Stripe checkout sessions are created server-side with idempotency keys tied to company + draft.

A browser success redirect is **not** payment authority. Fulfillment may begin only after a verified payment-provider webhook/event confirms the paid state.

Stripe webhook verification uses:
- the raw request body
- HMAC-SHA256 signature validation
- timestamp freshness tolerance
- constant-time signature comparison

## Connector consent

Customer connections:
- belong to one company
- carry explicit delegated actions
- may expire
- may be revoked
- cannot use actions the company itself does not expose

## Intent handoff

Ad/product interest handoff accepts only signed, short-lived, user-initiated context. Hidden ad targeting profiles are not treated as authority or silently imported into the shopping decision.

## Demo safety

The competition demo is intentionally non-transactional by default:
- no real charge
- no real order
- no real booking
- no claim of affiliation with demo companies

Live Muse use requires Meta Model API credentials. Live Stripe use requires Stripe credentials and webhook configuration. Real merchant/travel integrations require authorized provider APIs.

## Zero-trust enforcement status

Current hardening includes server-resolved connector authority, signed immutable drafts, human-authenticated exact approval tokens, one-time replay consumption, provider revalidation before commit, hashed production API credentials, and one-time provider webhook/link handling.

See `docs/zero-trust-production.md` for the full threat model and cutover gates.

## Production requirements

Before production money-moving use:
- managed secrets/KMS
- persistent OAuth/consent storage
- replay protection and idempotency persistence
- durable audit log
- rate limiting
- abuse/fraud controls
- provider webhook reconciliation
- observability and alerting
- privacy/data-retention policy
- deployment rollback and backup procedures
