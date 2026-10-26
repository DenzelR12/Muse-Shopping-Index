# Owner-Absence Operations

Muse Shopping Index should operate on an exception-first model: normal supplier, order, tracking and semantic events flow without owner intervention; only evidence-backed exceptions are surfaced.

## Exception classes

- Inventory failure: supplier/store inventory cannot be reconciled.
- Price anomaly: price deviates from the expected supplier/catalog range.
- Missing tracking: an order is marked fulfilled but lacks usable carrier tracking.
- Late fulfillment: dispatch exceeds the expected supplier window.
- Supplier sync failure: supplier feed or app synchronization fails.
- Payment exception: processor and internal ledger states disagree or require reconciliation.
- Dispute: processor dispute requires evidence and policy review.
- Return exception: return falls outside the standard deterministic return path.
- High-risk order: risk threshold is exceeded; models may explain evidence but never solely approve the money movement.
- Semantic QA failure: product context is insufficient for a top-ranked Muse Shopping Index recommendation.

## Operating rule

Routine events should be resolved automatically by deterministic policies. Critical exceptions and money-risk events require human review. Customer-facing delivery confidence must only be derived from verified fulfillment evidence; the presence of the Shop channel alone is not evidence that carrier tracking is valid.

## Event flow

Supplier/Shopify event -> verified ingestion -> normalize -> deterministic policy -> exception classifier -> audit event -> auto-resolution or owner review.

Every exception record should include the entity ID, source event, occurred-at timestamp, evidence, severity, decision path and resolution. Secrets, raw invite tokens and unnecessary customer PII must not be included in exception payloads.
