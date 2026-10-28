# Exactly-once execution guard — duplicates, retries, and bursts

**Status:** in code, tested locally (8/8, see below). Not mounted as a live route, not load-tested at 10,000 requests, not a scaling claim.

## The problem it solves

A consumer double-taps Approve. A network retry resends the same approval. A webhook is redelivered. A BI event is replayed. Ten thousand requests arrive at once. Without a guard, each of those can look like a new action — and a new action can mean a second charge, a second order, or double-counted revenue.

This guard stops a duplicate *before* any provider call, by claiming one stable key per logical action, per tenant.

## How a claim works

| Situation | Result | What the caller must do |
| --- | --- | --- |
| No claim yet | `won` — you are the only executor | Execute, then `complete()` with the result |
| Already completed | `duplicate` — original result returned | Return the original result. Do not execute again |
| In progress, within TTL | `in_progress` | Do not execute. Resume / poll for state |
| In progress, past TTL | `stale_reconcile` | Do NOT re-execute blindly. Reconcile with the provider first, then complete or release on evidence |
| Different tenant, same key | Separate claim | Tenant scope is part of the key. No cross-tenant claim ever wins another tenant's action |
| Principal company ≠ claim company | `muse_exactly_once_tenant_mismatch` (throw) | Fail closed |

Stable keys, by action: approval → `draftId`; payment → Stripe idempotency key; lead webhook → `leadgen_id`; BI outcome → `draftId`; reminder → consumer + draft. A different key is a different action, even for the same draft.

## Atomicity — where the guarantee actually lives

- **Postgres (`PostgresExactlyOnceStore`, table `muse_exactly_once_claims`, primary key `(company_id, claim_key)`):** claim is `INSERT ... ON CONFLICT DO NOTHING`. Two processes racing on the same key produce exactly one winner; the loser reads the winner's in-progress row. This is the multi-instance guarantee.
- **Memory (`MemoryExactlyOnceStore`):** single-process only, for tests. Its check-and-set is synchronous, so 100 concurrent claims in one process still yield exactly one winner — but it must never be presented as multi-instance protection.
- **Panel session consume** (existing `muse-panel-session-store.ts`) already uses an atomic Postgres `UPDATE ... WHERE consumed = FALSE` for the same reason; this guard is the shared layer underneath it, not a replacement for it.

## Bursts — what it does and does not do

The per-company, per-instance burst limiter admits up to 50 in flight, queues up to 200, then rejects with fail-closed `muse_execution_queue_full` — never a silent drop, never execution past the cap. That is a *safety* cap, not a *throughput* solution.

What remains unproven, honestly:
- No 10,000-request load test has been run (distinct actions, or concurrent approves on one draft, across instances).
- No queue service, autoscaling, or paid host is configured for a burst. The Render service is still a single Free-plan instance.
- Provider rate limits (Meta, Stripe, Shopify) are separate caps and are not solved by this guard.

To claim 10,000-request handling, the next steps are, in order: atomic Postgres consume (done in code here), a shared queue, a scaled host, and a measured concurrent load test with results counted — not assumed.

## Tests (local, 2026-10-28)

`apps/api/test/muse-exactly-once.test.ts`, run with `tsx --test`: **8/8 pass**
- 100 concurrent claims, one draft → exactly 1 winner, 99 in-progress
- Different drafts and different tenants claim independently
- Completed claim replays the original result, handler runs once
- Stale in-progress claim → `stale_reconcile`, no auto re-execution
- Cross-tenant principal → tenant mismatch, fail closed
- Definite failure may release; uncertain failure leaves in-progress
- Webhook redelivery and BI replay dedupe on stable keys
- Burst limiter: admit, queue, then fail closed at the cap

Postgres SQL is build-checked by CI (`tsc`), not live-tested against a database in this batch — same caveat as other store modules before their first live run.
