# Multi-company test tenants — Muse Shopping Index

> **TEST ONLY, NOT LIVE, NOT REAL.** This document and the demo it
> describes use test tenants, test products, and test prices only.
> Nothing here is a live seller, a live catalog read, a live payment,
> a live order, or a live shipment. Muse Shopping Index is a Muse
> feature, never a storefront, shop site, cart page, checkout page,
> or product-listing site.
>
> **Superseded in part, 2026-10-30:** the ClutchAgent TEST catalog has
> since been read live through the repo client (all checks pass — see
> [live Meta catalog proof](../meta/live-meta-catalog-proof.md)).
> Statements below describe the state at this batch's writing; the
> THEENRG / Shopify side remains not live.

## 1. What is code, what is TEST, and what is NOT live

| Layer | Status |
| --- | --- |
| Demo scenario code: `apps/demo/src/muse-multi-company-demo.ts` | Code. Pure function, no network, no real money, no real orders. It returns an ordered list of steps, each `{ tenant, step, outcome }`. |
| Demo tests: `apps/demo/test/muse-multi-company-demo.test.ts` | Code. Plain `node:test` + `assert`, no external dependencies. The test imports from `../src/muse-multi-company-demo.js` (the built output, per repo convention). |
| The two tenants, their products, and their prices below | TEST fixtures only. Hard-coded test data in the demo module, labelled TEST wherever they appear. |
| Any live Shopify read, live Meta catalog read, live payment, live Shop Pay execution, live Reel button, or live shipment | NOT live. None is claimed, and none is demonstrated by this batch. |
| A third real company (company C) | NOT in this batch. No third real company is added here, whatever its provider or verification entity. See §6 for how one would be added later. |

The only timestamp in the demo output is the fixed ISO test
timestamp `2026-10-27T12:00:00.000Z`. It is a TEST timestamp
chosen for the fixture, not a real event time, and no other date
appears in the demo output.

## 2. Tenant 1 — THEENRG.COM (Shopify tenant, TEST)

- **Role:** Company 1, the Shopify-side tenant.
- **Provider path:** Shopify Storefront API, read-only. No Admin API,
  no write calls, no live read in this batch.
- **Product in the demo:** a generic physical TEST product, shipped.
  It is a TEST label only — NOT a real THEENRG.COM product.
- **TEST terms (USD):** Item $58 + Tax $5 + Shipping $9 = Total $72
  (check: 58 + 5 + 9 = 72). Payment label: `Shop Pay · Saved payment`
  (no digits). Status in the demo is `processing` (TEST); tracking
  is not available yet in the demo, and no order number is issued.
- **Drift in the demo:** the item price changes from $58 to $64;
  tax stays $5 and shipping stays $9, so the new total is $78
  (check: 64 + 5 + 9 = 78). The old approval is gone, and a fresh
  exact review plus a fresh approval are required before any
  further step. Nothing is retried automatically.
- **NOT invented, NOT verified:** no real THEENRG.COM store details,
  real products, real prices, or Storefront token are stated or
  implied anywhere in this batch. The real store domain, the real
  test product, and the real Storefront token must be supplied and
  verified by the owner before any live read, and a token goes into
  a secret manager only — never into chat, screenshots, or the repo.

## 3. Tenant 2 — ClutchAgent (Muse Meta tenant/context, TEST)

- **Role:** Company 2, the Muse Meta context. ClutchAgent is the
  muse meta side of this demo.
- **What ClutchAgent is NOT here:** ClutchAgent is NOT a Shopify
  seller, NOT a Shopify service product, and NOT a service checkout
  product in this batch. No ClutchAgent service price, term, or
  entitlement is created.
- **Provider path:** Meta catalog, read-only, with Reel entry and
  the Muse panel. No catalog writes, no live read in this batch.
- **Brand facts, context only:** "AI Operating System for Athletes",
  recruiting / NIL / performance, ClutchAgent Inc,
  www.clutchagent.app. These facts describe the Meta context; they
  are not a product, a price, or a term, and they supply no facts
  to any exact review.
- **Product in the demo:** a generic TEST product reached via the
  Meta read-only path. It is a TEST label only — NOT a real
  ClutchAgent product and NOT a ClutchAgent service offering.
- **TEST terms (USD):** Item $40 + Tax $3 + Shipping $6 = Total $49
  (check: 40 + 3 + 6 = 49). Payment label: `Saved payment`
  (no digits). Status in the demo is `processing` (TEST); tracking
  is not available yet in the demo, and no order number is issued.
- **Unaffected by Tenant 1 drift:** when Company 1 drifts, Company 2
  review, approval, and status are unchanged at $49, and no
  Company 1 terms appear in Company 2 state. Company 2 needs no new
  approval. This is the cross-provider isolation check: a Shopify
  tenant change must not move a Meta tenant.
- **NOT verified:** no real ClutchAgent Meta catalog, System User,
  or token is verified in this batch. App Review and Business
  Verification are not done, and — see §8 — Meta Business
  Verification entity work is explicitly NOT in this batch.

## 4. Demo order (full effect, two tenants)

`runMultiCompanyDemo()` returns these steps, in this order:

1. Company 1 (THEENRG.COM, Shopify): Reel → exact review → approval → status.
2. Company 2 (ClutchAgent, Muse Meta): Reel entry → exact review → approval → status.
3. Company 1 drift → `reapproval_required`, with the diff in words
   (item $58 → $64; tax unchanged $5; shipping unchanged $9;
   total $72 → $78) and the old approval gone.
4. Company 2 unaffected (review, approval, and status unchanged at $49).
5. Per-company BI, tenant-trimmed, verified only, one outcome per
   draft: Company 1 BI counts draft 1 exactly once (approved at $72
   before drift; the drift outcome is not a second outcome), and
   Company 2 BI counts draft 2 exactly once (approved, $49).
   Company 1 BI includes no Company 2 outcomes, and vice versa.

## 5. Safety rules the demo never weakens

- No model, caption, Reel text, or browser field grants approval,
  signs a draft, or supplies a title or price. Every approval in
  the demo follows an exact review of the exact terms shown.
- One approval is bound to one set of exact terms and is
  consume-once. Any price, tax, shipping, or terms change requires
  reapproval; the old approval cannot be reused.
- Uncertainty goes to reconciliation, never to a blind retry. No
  step in this demo is retried automatically.
- No raw IDs appear in consumer output. `draft 1` and `draft 2`
  are plain test labels, not system identifiers. No tokens,
  secrets, account numbers, payment digits, or order numbers
  appear anywhere in the demo output.
- Payment labels are exactly `Saved payment` or
  `Shop Pay · Saved payment`, with no digits after them.
- Tenant scope is enforced in the demo shape itself: each step
  carries its tenant, each BI step reports only its own tenant,
  and no step mixes tenants.

## 6. How to add a third company later (not in this batch)

A third company — company C, real businesses and any verification
entity behind them — is explicitly NOT in this batch, pending a
store-owner call and owner-supplied real details. When, and only
when, an owner authorizes it, add it in this order, one company at
a time, test mode first:

1. **Enroll the principal.** One authenticated principal per
   company. The company id must equal the principal's org id;
   anything else fails closed.
2. **Manifest.** One manifest per company, tenant-scoped, with
   that company's readiness evidence only.
3. **Catalog connection per company.** Shopify Storefront
   read-only, or Meta catalog read-only, as fits that company —
   one connection per company, never shared. Owner-created
   credentials go straight into the secret manager, never into
   chat, screenshots, or the repo.
4. **Readiness.** The company's catalog read must be fresh and
   verified before any review is built from it. Stale or
   unverifiable means no exact review, not a best-effort review.
5. **Test product.** One agreed test product with exact title,
   price, currency, stock, shipping terms, and refund/cancel
   terms, in writing with the owner.
6. **Test Reel entry.** Reel or Reel entry into the Muse panel,
   supplying no facts itself.
7. **Test approval.** Exact review first, then one approval bound
   to those exact terms, consume-once.
8. **Test status.** Processing/status reporting for that tenant
   only, with no order number invented.
9. **BI check.** Tenant-trimmed, verified-only BI for the new
   company, confirming no other company's outcomes appear in it
   and no outcome is counted twice per draft.

### Per-company enrollment is never shared

- Never a shared token across companies. Never a shared catalog
  across companies. Never a shared payment credential across
  companies. One company, one enrollment, one manifest, one
  catalog connection, one readiness record, one BI trim.
- Authorization from one owner authorizes that owner's company
  only. It is not a platform-wide authorization, not a Shop Pay
  partnership, not Shop backend handling, and not Muse
  distribution.

## 7. What remains for real use (all NOT done in this batch)

- Owner-supplied real price and terms per company, agreed in
  writing with each owner.
- A real catalog token per company, in the secret manager only
  (Storefront token for a Shopify tenant; Meta token for a Meta
  tenant), supplied and verified by the owner.
- Real Postgres (the demo holds no state in a database).
- A real-browser run of the panel (the demo is a pure function,
  not a rendered panel in a browser).
- A production host passing bound methods to the panel, and live
  panel routes mounted (panel routes exist as code-ready handlers
  only; mounting is a separate step).
- Meta verification only if and when the owner chooses it as a
  separate step — explicitly NOT in this batch.

## 8. What is still unverified, by tenant

**THEENRG.COM (Shopify) — unverified:** the real store domain,
the real product, and the real Storefront token. No live Shopify
read has been performed or claimed.

**ClutchAgent (Meta) — unverified:** the real Meta catalog, the
System User, and the token. At this batch's writing no live Meta
catalog read had been performed; the TEST catalog read has since been
verified live (2026-10-30 — see the supersession note at the top of
this doc). App Review is not done. Business Verification
is not done.

**Meta Business Verification entity work — NOT in this batch:**
no verification entity, business-entity, legal-name/address, or
verification-document work is included here, and no outcome of
such work is claimed. If the owner later chooses Meta verification
as a separate step, it is a separate step with its own evidence,
not a continuation of this demo batch.

## 9. What this batch explicitly does NOT include

- No third real company (company C), no real business enrollment,
  and no verification-entity work.
- No live Shopify read, live Meta catalog read, live payment, live
  Shop Pay execution, live Reel button, native Muse distribution,
  or live shipment.
- No real THEENRG.COM product, price, store detail, or token; no
  real ClutchAgent catalog, System User, token, service price,
  service term, or service entitlement.
- No secrets, tokens, raw IDs, payment digits, order numbers, or
  invented dates in the demo code, tests, or this document, beyond
  the single fixed TEST timestamp named in §1.

## 10. Both tenants use Muse Shopping Index (user clarification, 2026-10-27)

Both THEENRG.COM and ClutchAgent are tenants/users of the Muse
Shopping Index platform itself — the same core flow (Reel → Muse
window → exact review → one approval → server execution), with
different provider adapters (Shopify Storefront read-only for
THEENRG.COM, Meta catalog read-only for ClutchAgent). They are NOT
separate products outside Muse Shopping Index, and no separate
ClutchAgent product or separate THEENRG product is built in this
batch. Per tenant, the flow is the same Muse Shopping Index flow
under the same safety model:
- THEENRG.COM: Shopify Storefront read-only catalog → Muse Shopping
  Index exact review → one approval → server execution, tenant-isolated.
- ClutchAgent: Meta catalog read-only / Reel entry → Muse Shopping
  Index exact review → one approval → server execution, tenant-isolated.
A consumer or company for one tenant must not see the other tenant's
drafts, catalog, orders, or BI — that isolation is what the harness
tests and the demo's tenant-trimmed BI prove. Ownership of
THEENRG.COM (user's own vs a store-owner's) is still NOT clarified
and is not assumed here.
