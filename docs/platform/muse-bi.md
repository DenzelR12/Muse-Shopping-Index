# Muse Business Intelligence — secondary demo (AdJudge guardrails)

Status: demo / secondary. Read-only reporting over **SUPPLIED / DEMO events
only**. There is no live Meta ad ingestion, no live Shop/Meta/payment
claim, and BI never changes campaigns, budgets, routing, ranking, or
policy. Every report is labeled `DEMO/SUPPLIED EVENTS` everywhere it is
shown (JSON `dataSourceLabel`/`demoLabel`, dashboard banner, CSV header).

## BI gates — do not ship BI without both in code

1. **Metric verification contract as code**
   (`apps/api/src/muse-bi.ts`).
   Every metric-bearing report carries: definition name + version,
   source/version, `computed_at`, freshness SLA, code version, input
   hash (SHA-256 over a canonically ordered JSON of the trimmed inputs),
   and verification status `verified | stale | unverifiable`.
   - `verified` — source valid, input hash matches, and the result is
     within its freshness SLA: it may be stated as a current claim,
     with provenance.
   - `stale` — a previous result exceeds its freshness SLA: it may only
     be shown labeled `stale`; `assertVerifiedForCurrentClaim()` blocks
     it from current claims.
   - `unverifiable` — source, schema, definition, or recomputation
     cannot be validated, or the input hash was tampered with: blocked
     from current factual claims.
2. **Tenant trimming at the BI query layer, before aggregation**
   (`queryBiReport()` in `apps/api/src/muse-bi.ts`). The company ID is
   derived from the authenticated principal only — never from a request
   query/body parameter. A caller-supplied company ID that differs from
   the principal fails closed (`bi_tenant_mismatch`); an empty principal
   fails closed (`bi_principal_required`). Only approved metrics and
   dimensions are accepted; anything else is rejected, never answered
   with a fallback query. Cross-company access therefore fails closed,
   and the API routes (`GET /v1/muse/bi/report|dashboard|export`) use
   `principal.orgId` as the company.

## Funnel instrumentation

`recordBiFunnelEvent()` / `PostgresBiEventStore`
(`apps/api/src/muse-bi-store.ts`, tables `muse_bi_events` and
`muse_bi_watermarks`, created with `CREATE TABLE IF NOT EXISTS`) carry
`campaignId` and `reelId` plus `companyId` through the stages:

`intent → review → approval → transaction → verified_outcome`

Each event is keyed by `draftId` + `companyId` and may carry evidence
refs (`approvalJti`, `approvalHash`, `transactionRef`, `orderRef`,
`outcomeRef`) used by the forensics timeline. The Postgres store follows
the existing store pattern in this service; it records supplied/demo
events and events carried from the existing transaction path by
server-side callers only. It does not ingest live Meta ads.

## Attribution rules (stated, not implicit)

- **Window: 30 days.** A verified outcome is attributed only when it
  falls within 30 days after that draft's first intent
  (`ATTRIBUTION_WINDOW_DAYS = 30`). Outcomes before any intent, or
  after the window, are not attributed.
- **One outcome attributed once.** Only the first in-window verified
  outcome per `draftId` is attributed; later outcomes for the same
  draft are marked `duplicate_outcome_for_draft` and do not add revenue
  or orders.
- **Refunds and cancellations adjust ROAS/revenue.** An attributed
  outcome contributes `amount − refundAmount`; a cancelled outcome
  contributes 0. ROAS uses paid attributed revenue only (organic
  outcomes have no campaign spend and would otherwise inflate it).
- **Organic vs paid is set at event creation.** A campaign ID present
  at creation means `paid`; absent means `organic`. It is stored on the
  event and never inferred or rewritten later — query code reads the
  stored value, and a supplied event whose `acquisition` disagrees with
  its campaign presence is rejected
  (`bi_supplied_acquisition_mismatch`).
- **ROAS requires supplied spend.** ROAS is `paid attributed revenue /
  supplied spend`. When spend is not supplied for an attributed
  campaign, the metric is `unverifiable` with `roas: null` — spend is
  never invented.

## Watermark / freshness refresh

One watermark per (metric, company): last verified artifact timestamp +
input hash (`muse_bi_watermarks`, or `InMemoryBiEventStore` in tests).
`applyBiIngestionResult()` advances a watermark **only** on a
successful, verified ingestion. On ingestion failure it does **not**
advance, retains the last verified artifact, and subsequent output is
`stale` (prior artifact exists) or `unverifiable` (none exists).
Data-contract failures do not silently publish replacement results.

## Forensics timeline + human-approved remediation

`buildBiForensicsTimeline()` returns a timeline keyed by `draftId`
(intent → review → approval → execution → outcome), each entry with
evidence refs: `draftId`, approval JTI/hash, transaction/order refs,
and timestamps. `proposeBiHypothesis()` labels outputs as hypotheses
with cited evidence (`causalClaim: false`) — never unsupported causal
conclusions.

For `RECONCILE_REQUIRED`, `proposeReconcileRemediation()` returns a
**proposal only**: it carries risk, rollback, owner, and measurable
success criteria, has status `PROPOSED_REQUIRES_HUMAN_APPROVAL`, and
`autoRetryPayment: false`. There is deliberately no execute function
for a remediation proposal in the BI module, and BI never auto-retries
a payment. Execution, if a human approves it, goes through the existing
human-approved provider reconciliation route — not through BI.

## Reporting API (read-only, authenticated, company-scoped)

Authenticated via the API's existing principal (API key / credential
authority); unauthenticated requests get 401 before any BI code runs.

- `GET /v1/muse/bi/report?metric=<metric>&dimensions=<a,b>`
  — JSON report with provenance, freshness, and verification status.
- `GET /v1/muse/bi/dashboard?metric=…&dimensions=…`
  — HTML dashboard, demo banner + provenance on every view.
- `GET /v1/muse/bi/export?metric=…&dimensions=…&format=csv`
  — CSV export, provenance header first.

Demo data source: the environment variable
`MUSE_BI_DEMO_EVENTS_JSON` (a JSON array of supplied funnel events,
validated by `parseSuppliedBiEvents()`). With no such configuration the
routes return `503 muse_bi_demo_events_not_configured` instead of
inventing data. Approved metrics: `funnel_counts`,
`funnel_conversion`, `verified_orders`, `attributed_revenue`, `roas`.
Approved dimensions: `campaignId`, `reelId`, `acquisition`,
`paymentVehicle`. No other route, parameter, or BI output changes
campaigns, budgets, routing, ranking, or policy.

## Explicitly not ported from AdJudge

Creative-quality scores, the AdControlCenter dataset, any
creative-label → purchase prediction, `auto_approve` for payments, and
live Meta ad reporting. Live Meta ad ingestion remains blocked: it
needs an authorized advertising connection, which is not in place, and
no BI output in this step claims otherwise.

## Tests

BI tests are appended to the existing
`apps/api/test/provider-observability.test.ts` (which CI already runs),
not a new test file — so no workflow edit is needed, and none was made.
They cover: verified/stale/unverifiable + tampered hash, tenant
trimming before aggregation, unknown metric/dimension rejection,
attribution once per draft within 30 days, refund adjustment, ROAS
without spend, watermark non-advancement on failure, forensics
evidence refs, hypothesis labeling, remediation-as-proposal-only, and
the Postgres store's company trimming and watermark persistence
(fake pool, as with the existing observability tests).
