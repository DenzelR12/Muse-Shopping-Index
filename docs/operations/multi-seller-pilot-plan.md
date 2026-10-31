# Multi-seller pilot plan — Muse Shopping Index

## Limits — read first

- **Plan only, not a pilot.** No sellers are verified yet. No store,
  token, or seller is verified as of this writing, and a store-owner
  call is pending later 2026-10-27. The three seller slots below are
  empty on purpose: a seller is added only when its owner authorizes
  it, and only in test mode first.
- **Muse feature, not a storefront.** Each seller is a provider behind
  the server's generic execution adapter, tenant-scoped, with a signed
  draft, consume-once approval, and revalidation. No seller gets a
  storefront, shop site, cart page, checkout page, or product-listing
  site from this project, and the Muse panel is never a frontend for a
  seller's catalog.
- **Test-only first, always.** No live price changes, no customer
  messages, no real money, no public app, and no customer-facing change
  without a separate, explicit approval for that exact change.
- **One store is not all stores.** Authorization from one store owner
  authorizes that store only. It is not a platform-wide authorization,
  not a Shop Pay partnership, not Shop backend handling, and not Muse
  distribution.

## 1. Why three sellers, and why different

One seller proves the code works for one seller. Three sellers, in
different categories and at different price points, prove the adapter
and the panel are not tuned to one product. The pilot is designed to
find the differences, not to hide them: different shipping terms, tax
treatment, stock behaviour, and price-change frequency are the point.

| Slot | Category (example, not a commitment) | Price point | What it tests |
| --- | --- | --- | --- |
| Seller 1 | Physical goods, single item | Low–mid | Basic read → review → approval → test order, cheapest path. |
| Seller 2 | Physical goods, configuration options | Mid–high | Configuration in the exact review, drift on an option change, reapproval. |
| Seller 3 | Different category from 1 and 2 (e.g. a second physical category, or a service/pickup variant if the seller's terms support it) | Different from 1 and 2 | Tenant separation: three companies, three manifests, no cross-company leakage, no shared catalog, no shared token. |

Seller names, store names, and products are filled in only after each
owner authorizes, and only in a secret manager / Render, never in chat,
never in the repo, and never in a screenshot.

## 2. Onboarding checklist (per seller, in order)

Read-only first. No step is skipped because a previous seller passed it.

1. **Owner and store type.** Whose store is it, and is it a development
   store or a live store? A development store is test-only by
   construction. A live store gets test products only, never live
   product or price changes.
2. **One test product.** Exact title, price, currency, stock, shipping
   terms, and refund/cancel terms, agreed in writing with the owner.
   One product, not the whole catalog, for the first read test.
3. **Authorization, owner-created.** For a store the owner controls:
   the owner creates a single-store custom app in their own store
   admin, grants read-only scopes first (`read_products`, plus
   `read_inventory` only if needed), installs it, and puts the token
   straight into the secret manager / Render. The token is never sent
   in chat, never screenshotted, and never stored in the repo. For a
   store the project does not own, the owner does the same in their
   admin, or grants a limited collaborator account with an audit trail
   for admin work (a collaborator account is not an API token). A
   partner-app OAuth flow for many stores is a later, separate step
   and is not part of this pilot.
4. **Revocable by uninstall.** The owner is told, before the first
   read, that uninstalling the custom app revokes access, and that
   access is test-only and revocable at any time.
5. **Read test.** Validate title/price/currency/stock against the
   agreed test product, check 24-hour freshness, strip raw IDs, label
   the output SHOPIFY / TEST (or META CATALOG / TEST for a Meta
   catalog read), and confirm the tenant is that company only. Record
   the read as code-verified + test-read-verified, or as failed — never
   as a live seller claim.
6. **Panel test.** Show the agreed test product in the Muse feature
   panel (host-mounted, server state only), with exact review,
   approval, resume, and reapproval on a changed price, all in test
   mode. No real money at any point in this step.
7. **Test order (only after steps 1–6 pass, and only with explicit
   approval for that exact test).** A test-mode order through the
   generic execution adapter, with reconciliation checked and no
   second execution on uncertainty. Bogus/test payment only on a
   development store; never a real card on a live store for a pilot
   test.

## 3. What is measured per seller

Use `docs/research/impact-measurement-protocol.md` for every seller, with the
same tables. Per seller, record additionally:

- Read success and freshness (was the catalog read fresh, stale, or
  unverifiable?).
- Drift frequency (how often did the test product's price or terms
  change between review and approval in test mode?).
- Resume and reapproval counts, tenant-scoped, using the counting
  rules in the impact protocol §5.
- Any cross-tenant attempt, however it arose, and its refusal.

## 4. What the pilot does NOT prove

- It does not prove Shop Pay, Shop backend handling, or Muse
  distribution. Those need their own partnerships and approvals.
- It does not prove a native Reel button. The entry contract and
  simulator (`docs/platform/muse-entry-contract.md`) remain the aim, and Meta
  distribution approval remains outstanding.
- It does not prove a business model. See
  `docs/research/business-model-options.md` — the model is decided (option A, 2026-10-31), and the
  pilot must not be presented as if a model had been chosen.
- It does not prove scale. Three test-mode sellers are a pilot, not a
  network, and must be described as such.

## 5. Pilot slots (empty until authorized)

| Slot | Seller (owner-authorized only) | Store type | Test product | Read test | Panel test | Test order |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | — | — | — | Not done | Not done | Not done |
| 2 | — | — | — | Not done | Not done | Not done |
| 3 | — | — | — | Not done | Not done | Not done |

## Multi-company TEST demo (pointer)

Two TEST tenants now demonstrate the full effect in code, not live:
Company 1 = THEENRG.COM (test, Shopify tenant — Storefront read-only,
physical TEST product) and Company 2 = ClutchAgent (test, Muse Meta
tenant/context — Meta catalog read-only, Reel entry, Muse panel).
ClutchAgent is NOT a Shopify seller and NOT a service checkout product
here, and no ClutchAgent service price, term, or entitlement is created.
See `apps/demo/src/muse-multi-company-demo.ts` (pure demo scenario, no
network, no real money, no real orders), its tests in
`apps/demo/test/muse-multi-company-demo.test.ts`, and the full tenant
record in `docs/sellers/multi-company-test-tenants.md`. The demo runs the
Shopify flow, then the Meta flow, then a Company 1 drift to
`reapproval_required` (old approval gone) with Company 2 unaffected,
then per-company tenant-trimmed, verified-only BI. No third real
company (company C) is in this batch, and Meta Business Verification
entity work is explicitly NOT in this batch. For THEENRG.COM, the real
store domain, product, and Storefront token are still unverified and
must be supplied by the owner before any live read; for ClutchAgent
Meta, the real catalog, System User, and token are still unverified,
and App Review / Business Verification are not done.
