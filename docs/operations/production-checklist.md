# Production readiness checklist

## Commerce
- Shopify product, variant, inventory, order and fulfillment ingestion
- Signed webhook verification and replay protection
- Supplier normalization for Collective, Zendrop and Syncee
- Tracking propagation and missing-tracking exceptions

## Intelligence
- Semantic completeness scoring per product
- Recipient, occasion, intent, use-case and bundle-role enrichment
- Delivery confidence from evidence, not guesses
- Budget-aware bundles with redundancy checks and rationale
- Recommendation provenance and audit events

## Storefront / SEO

> LEGACY — NOT THE PRODUCT SURFACE. This section is the
> source-copy storefront checklist. The Muse feature has no
> server-rendered product pages, no shop site, and no SEO
> surface: the product surface is a Muse feature panel mounted
> by a Muse host inside a Muse window/surface. These bullets
> are kept as a record of the legacy checklist, not as
> requirements for the Muse feature.

- Server-rendered product pages and Product/Offer structured data
- Canonical URLs, titles, descriptions, alt text and clean taxonomy
- Accurate price, availability, shipping and returns
- Muse Shopping Index result labels and Why this signal explanations

## Security
- Signal Shield authorization before privileged actions
- Link Authority signed/scoped/expiring/revocable tokens
- Server-side re-derivation of protected transaction state
- Idempotency on writes and webhook handlers
- Secret management outside source control

## Owner-absence operations
- Inventory mismatch alerts
- Supplier sync failures
- Missing or late tracking alerts
- Price anomaly alerts
- Payment/dispute/return exceptions
- Semantic QA regression alerts
- Daily exception digest

## Release
- Database and migrations
- Authentication / RBAC
- CI green
- staging deployment
- observability and alerting
- rollback procedure
- backup / restore test
