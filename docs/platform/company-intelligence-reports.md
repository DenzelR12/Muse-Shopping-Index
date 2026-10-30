# Company Intelligence Reports

This layer adapts the strongest reusable patterns from the AdJudge Guardrails repository into Muse Shopping Index's commerce context.

## Reused architectural ideas

- tenant-scoped analytics
- governed metric definitions
- verified / stale / unverifiable status
- provenance and freshness SLAs
- deterministic report generation
- fail-closed metric claims
- experiment and ownership-friendly reporting

## Report domains

Each company can receive one scoped report covering:

1. **API usage**
   - request volume
   - endpoint usage
   - errors
   - latency
   - estimated model/API cost

2. **Vertical performance**
   - retail
   - travel
   - tickets
   - services
   - reservations
   - digital
   - any future connector vertical

3. **Ad-to-commerce efficiency**
   - impressions
   - clicks
   - Muse opens
   - searches
   - drafts
   - approvals
   - purchases
   - delivered outcomes
   - returns
   - CTR
   - click-to-purchase conversion
   - ROAS
   - cost per purchase

4. **Commerce quality**
   - fulfillment completion
   - returns/cancellations
   - on-time delivery
   - company reliability
   - index learning contribution

## Data contract

Every event must carry a company ID. Queries and reports filter by that ID before aggregation.

Metric-bearing reports should expose:
- definition version
- source/version
- computation timestamp
- freshness SLA
- code version
- input hash
- verification status

A stale or unverifiable metric must not be presented as a current verified claim.

## Workflow

```text
Company API/connector calls
        +
Ad/campaign intent events
        +
Muse shopping funnel events
        +
Payment/fulfillment outcomes
        ↓
Tenant-scoped event store
        ↓
Governed metric computation
        ↓
Verification + freshness
        ↓
Company Intelligence Report
        ↓
Dashboard / scheduled report / API
```

The company report is intentionally read-only. It never changes campaigns, budgets, routing, ranking, or policy on its own.
