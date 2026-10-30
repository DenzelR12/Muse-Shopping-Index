# Impact measurement protocol — Muse Shopping Index

## Limits — read first

- **Protocol only, not results.** This document defines how Impact would be
  measured. It contains no measured numbers, because no live seller, live
  read, or live run has been verified yet. Any number added later must be
  entered in the tables below with its date, seller type, and run
  conditions, or it does not count.
- **Not live.** No seller is verified, no store-owner call has happened
  yet (pending later 2026-10-27), and the Render database does not exist
  yet, so no live run can be measured against this protocol today.
- **Muse feature, not a storefront.** The Muse path measured here is a
  Muse feature panel mounted by a Muse host inside a Muse window/surface.
  The comparison path is the incumbent flow a seller already uses today
  (a separate, Shopify-hosted checkout), measured as a control — it is
  not this product, and this product is never described as a checkout
  page, cart page, shop site, or product-listing site.
- **Assistant assessment, not a judge score.** Nothing here raises a
  rubric score by itself. Scores move only when measured evidence is
  recorded under this protocol and shown in the submission.

## 1. The A/B comparison

Same seller, same product, same price, same shipping terms, same test
window. Only the path changes.

| Arm | Path |
| --- | --- |
| Control | Consumer reaches the seller's existing checkout flow on their own (link, store, or message), completes it without Muse. |
| Muse | Consumer taps "Shop this reel" on Meta, a Muse window opens, the Muse feature panel shows the exact review, the consumer approves once, the server executes. |

Run both arms with the same test product and the same test consumer
conditions. Do not compare a Muse test product against a different
control product, a different price, or a different shipping term — that
comparison proves nothing.

## 2. Metrics and timestamp definitions

Record every timestamp in UTC, from the server or the host clock, never
from a model, a caption, or a consumer's device clock alone.

| Metric | Definition | Unit |
| --- | --- | --- |
| Clicks to approval | Counted interactions from the Reel tap to the explicit approval action. A re-render, a resume prompt, and a reapproval are counted separately and labelled as such. | count |
| Tap → review | Reel tap timestamp → exact review first rendered in the Muse window. | seconds |
| Review → approval | Exact review first rendered → explicit approval action. Includes reading time; it is not a speed contest, and a longer time for a screen-reader review or a reapproval is expected, not a failure. | seconds |
| Approval → verified order | Approval action → server-verified order state (not "submitted", not "processing"). | seconds |
| Verified order → delivered | Verified order → carrier-confirmed delivery (or pickup confirmation for pickup). Seller/carrier-controlled; reported separately from chat time, never merged into it. | days/hours |
| Completion rate | Approved drafts that reach verified order, divided by exact reviews presented. | % |
| Abandonment rate | Exact reviews presented that are never approved, divided by exact reviews presented, split by point of abandonment (see §3). | % |
| Errors | Tampered drafts rejected, expired drafts, drift reapprovals, reconciliation cases, cross-tenant refusals — each counted by error name, never lumped as "errors". | count by error |
| Support contacts | Consumer or seller support contacts about this order, counted per verified order. A lower number is a secondary signal, never a primary claim. | count per order |

The headline number, when it exists, is reported as three numbers, never
one: (a) tap → approval, (b) approval → verified order, (c) verified
order → delivered. A single "chat to door" number hides which part Muse
controls and which part the seller/carrier controls, so it is not used.

## 3. Abandonment, split by point

Abandonment is not one number. Split it, because the recovery for each
point is different:

1. **Intent before details** — consumer leaves before missing details
   are collected. Recovery: nothing exists yet, or at most a reminder
   only if the consumer later opts in at review (opt-in cannot happen
   before a review exists).
2. **At review, unapproved** — consumer leaves after seeing the exact
   review. Recovery: resume-by-draft, revalidated first (see
   `docs/research/accessibility-abandoned-recovery.md` §8 and
   `apps/api/src/muse-abandoned-recovery.ts`).
3. **After approval, executing** — consumer leaves while execution is
   in progress. Recovery: execution state only, never a fresh Buy and
   never a second execution.
4. **After approval, authentication required** — trusted checkout
   fallback only, same draft.

For each point, record: count, resumed count, reapproved count, and
verified-order count. A resumed draft that is never reapproved is not a
recovery. A reapproved draft that is never verified is not revenue.

## 4. Verified-only revenue rule

Payment is counted only when the server records a verified order.
"Submitted", "processing", "payment intent created", and "checkout
started" are never counted as revenue, recovered revenue, or Impact.
Refunds subtract from the same metric, in the same tenant, for the same
draft outcome (one outcome per draftId). This rule comes from the
existing BI module (`apps/api/src/muse-bi.ts`): tenant trim before
aggregation, watermark only on verified success, one outcome per
draftId, refunds subtract. See §5 for the counting rules.

## 5. Abandoned recovery measurement (from existing BI)

How resumed drafts, reapproval rate, and verified recovered revenue are
counted — counting rules only, no numbers yet:

| Measure | Counting rule |
| --- | --- |
| Resumed drafts | Drafts returned to via resume-by-draft, counted once per draftId, tenant-scoped to the owning company and owning consumer. A resume prompt shown is not a resume; only a revalidated return to a review counts. |
| Reapproval rate on drift | Reapprovals granted on a new draft after an expired or changed review, divided by reapproval-required decisions. The old review and old approval are never carried, so a carried approval can never inflate this rate. |
| Verified recovered revenue | Sum of verified order totals for drafts that were abandoned at review and later resumed and approved, minus refunds on those drafts. Counted only after verification, never at approval or at resume. |
| Reminder effect | Reminders sent (one only, generic, opt-in only) vs resumes that followed a reminder, reported as a correlation, never as proof the reminder caused the resume. A reminder that was never sent counts as nothing. |
| Watermark | The BI watermark advances only on verified success. A failed or uncertain run never advances it, so a failed run can never be counted twice by a later successful run. |

Empty results table (fill after a live test; leave blank until then):

| Measure | Test run (date / seller type) | Count / rate | Verified? |
| --- | --- | --- | --- |
| Resumed drafts | | | |
| Reapproval rate on drift | | | |
| Verified recovered revenue | | | |
| Reminder-sent → resumed | | | |

## 6. Consumer protection quantification (rehearsal first, live second)

Rehearsal counts come from existing tests and the offline rehearsal
script (`scripts/rehearse-muse.mjs`), which runs with no money and no
live provider. Live counts come only from a verified test-mode run.
The two columns are never merged.

| Protection case | Rehearsal: how it is counted | Live: how it is counted |
| --- | --- | --- |
| Drift caught → reapproved | Rehearsal runs where a price/tax/shipping/terms change after review produces a reapproval-required decision, not an execution. | Same, on a real catalog change in test mode. |
| Tampered drafts rejected | Tests/runs where a draft whose hash, amount, currency, or payment authorization no longer matches is rejected, with no approval consumed. | Same, on a real tampered draft in test mode (test data only). |
| Uncertain executions reconciled, not retried | Runs where an uncertain completion enters reconciliation (RECONCILE_REQUIRED) and is escalated, never blindly re-executed. | Same, on a real uncertain execution in test mode. |
| Cross-tenant attempts rejected | Tests/runs where a principal acting for one company, or a consumer acting for another consumer, is refused before any provider call. | Same, on a real cross-tenant attempt in test mode (test data only). |

Empty results table:

| Protection case | Rehearsal count (source) | Live count (date / run) |
| --- | --- | --- |
| Drift caught → reapproved | | |
| Tampered drafts rejected | | |
| Uncertain → reconciled, not retried | | |
| Cross-tenant attempts rejected | | |

## 7. No-dark-pattern checklist for recovery

Recovery counts only if every item below holds. If any item fails, the
recovery is not counted as Impact, however many orders it produced.

- [ ] Reminder only after an explicit opt-in at review, default OFF,
      mounting the panel never opts anyone in.
- [ ] One reminder only, via an authorized channel only, fail-closed
      without a configured authorized channel.
- [ ] Reminder message is generic only: no price, no seller, no pitch,
      no product name. ("Your review is waiting in Muse. Open Muse to
      return to your review." — the frozen payload in
      `apps/api/src/muse-reminder.ts`.)
- [ ] One-tap opt-out / dismiss, permanent for that pending record.
- [ ] No fake countdown, no fake stock, no discount lure. A discount is
      new terms, which means a new review and a fresh approval.
- [ ] No repeated nudges, no model persuasion, no retargeting: an
      abandoned draft is never fed into Meta retargeting or any ad
      system, and never shared across companies or consumers.
- [ ] Expiry is stated factually with a warning before expiry; expiry
      leads to revalidation and a fresh review, never to a lost order,
      a silent retry, or an automatic charge.

## 8. What would NOT count as evidence

- A synthetic demo run presented as a live measurement.
- A single run with no control arm, presented as an improvement.
- Revenue counted at approval, at submission, or at "processing".
- A resumed draft counted as recovered revenue before verification.
- A headline time that merges chat time with seller/carrier time.
- Any number whose date, seller type, product, and run conditions are
  not recorded in the tables above.
