# Infrastructure plan

- API gateway/WAF in front of all public services.
- Secrets in managed KMS/secret manager only; never Shopify metafields/theme/client/GitHub.
- Postgres for operational state; append-only audit stream for security/payment events.
- Redis for rate limits, idempotency, nonce consumption, short-lived sessions.
- Queue/event bus for Shopify/supplier/payment webhooks.
- Object storage for signed evidence and product-ingestion artifacts.
- Observability: traces, structured logs, SLOs, alerting on fulfillment/payment/security exceptions.
- All partner redirects resolved server-side from allowlisted destination IDs.
