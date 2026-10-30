# Read-only Shopify catalog client — code, gated, not live-verified

Status: client code only. This document describes code that exists in
`apps/api/src/shopify-catalog.ts`. It does **not** claim a live
Shopify catalog connection, a live read, a live seller, a Shop Pay
partnership, Shop backend handling, or Muse distribution. A live
read has not succeeded yet, and none is claimed here. At the time of
this change, no Shopify store, token, or seller is verified, and a
store-owner call about a real store is pending — this client was
built so that call can be answered with code that is already ready,
not with a promise to build it later.

## What this is — and what it is not

- This is a **Muse feature provider**: Shopify is one provider
  behind the server, used to validate a catalog before any review
  is rendered. It is **not a storefront**: it builds no shop site,
  no cart page, no checkout page, and no product-listing site, and
  it must never be presented as one.
- Parent project: **Muse Shopping Index** (this repo). A Shopify
  store, if one is ever connected, belongs to one authenticated
  company inside that project — it is not a separate product, and
  one store's access never authorises another company's catalog.

## The one read path, chosen deliberately

**Shopify Storefront API product query only**, with a Storefront
access token. The Admin API is **not** used by this client: no Admin
token is read here, no Admin endpoint is called, and no admin
privilege is needed for a catalog read. The Storefront API is the
shopper-facing, read-oriented API, so it is the narrowest privilege
that can answer "what does this company sell, at what price, in
stock or not."

Reads, only, through fixed query documents defined in the module
(callers supply only a handle or a page size, never a query):

- `POST https://{storeDomain}/api/{version}/graphql.json` —
  `query ShopifyCatalogProducts` — product list
- `POST https://{storeDomain}/api/{version}/graphql.json` —
  `query ShopifyCatalogProduct($handle)` — one product by handle

The token travels only in the `X-Shopify-Storefront-Access-Token`
header, never in a URL, and is never logged or echoed.

## Read-only rule — enforced in code, not just in policy

- The transport has exactly one method, `query`, and it accepts
  only GraphQL query operations. A document that does not start
  with the `query` keyword, or that contains `mutation` or
  `subscription`, is rejected before any network call with
  `muse_shopify_query_not_readonly`.
- The client interface exposes exactly two reads, `fetchProducts`
  and `fetchProduct`. There is no cart, no checkout, no write, no
  order, and no customer endpoint anywhere in this module, and no
  way to express one through it. A write would require new code,
  which this module's review rule forbids.
- `readShopifyCatalog` and `readShopifyProduct` are internal
  helpers — the narrowest API surface. There is deliberately **no
  new public route** in this change. A future route, if one is ever
  added, must authenticate the principal, pass that principal's
  company as both the requesting company and the principal,
  resolve the store domain from that company's own manifest (or
  `SHOPIFY_STORE_DOMAIN`), and label its output READ-ONLY with the
  source and TEST labels below until a real read is verified.

## Environment variables (names only — never values)

- `SHOPIFY_STORE_DOMAIN` — deployment-level store domain, e.g. a
  `*.myshopify.com` domain. A domain that is not a
  `*.myshopify.com` domain is a configuration error, never a
  fallback. Values go in the deployment secret manager only.
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN` — Storefront access token
  for that store's custom app (read scopes only at first: the
  catalog read needs no write scope). Stored only in the
  deployment secret manager, never in the repo, chat, logs, or
  tests. This client reads it from the environment at runtime
  only; no value was read, copied, or used while building it.
- `SHOPIFY_API_VERSION` — Storefront API version, default
  `2025-07` when empty.

Note: `SHOPIFY_ADMIN_ACCESS_TOKEN` and `SHOPIFY_SHOP_DOMAIN`
already appear elsewhere in `.env.example` for other, older
flows. They are **not** used by this client, and this client must
not be configured with an Admin token: that would widen the
privilege beyond what a catalog read needs.

## Fail-closed behaviour

In order, before any network call:

1. `SHOPIFY_STOREFRONT_ACCESS_TOKEN` missing →
   `muse_shopify_catalog_not_configured`. No approval consumed,
   no network call.
2. Token present but no startup-registered client →
   `muse_shopify_catalog_client_not_registered`. Clients are
   registered only at server startup by the operator, never over
   HTTP, never from a request body, never the synthetic fixture.
3. Requesting company differs from the authenticated principal's
   company → `provider_readiness_company_mismatch` (the existing
   readiness error name). A read is only ever for the
   authenticated company's own store.
4. Store domain missing (no manifest store domain and no
   `SHOPIFY_STORE_DOMAIN`) → `muse_shopify_store_not_configured`.
   There is never a default store, and a store is never shared
   across companies: a manifest store domain wins over
   `SHOPIFY_STORE_DOMAIN`, and only for the company that
   manifest belongs to.
5. Bad store-domain or version configuration →
   `shopify_catalog_config_invalid`.
6. A non-query document → `muse_shopify_query_not_readonly`,
   before any network call.

Config returns presence booleans only.

## Validation on read

Items are validated against the same rules as the Meta catalog
client (schema, title, price, currency, availability/stock where
returned):

- Title required, 1–200 characters.
- Price required and positive, from the first variant's Money
  object (`amount` + `currencyCode`); currency must be a 3-letter
  code. A product with no variant price is unverifiable, never
  priced by guess.
- Freshness SLA is 24 hours (the same SLA as `muse-bi.ts`). An
  item carrying a timestamp older than 24 hours — or unparseable,
  or in the future — is **unverifiable / refresh required**: it
  is listed as unverifiable, never presented as current, and its
  price is never guessed. Items with no timestamp are stamped by
  the read itself (`fetchedAt`); the result carries
  `validUntil = fetchedAt + 24h`, after which a fresh read is
  required.
- A product that is not `ACTIVE`, or whose first variant is not
  available for sale, is valid but unavailable: it goes in the
  `unavailable` bucket, not the `verified` bucket.
- Consumer output strips raw provider IDs: only the resolved
  title, price, currency, and availability leave this module.
  Shopify product/variant IDs (`gid://shopify/...`), handles,
  and store domains never appear in a read result.

Output is labelled on every read:

- `source: 'SHOPIFY'`
- `label: 'TEST — development / test store'`

It must never be presented as a live seller's live catalog until
a real read is verified against a real store, separately from
this code change.

## What this client never does

- No review is rendered, no draft is signed, no approval is
  issued, no purchase is executed, and no approval is consumed
  by a read.
- No cart is created, no checkout is started, no order is placed,
  no customer record is read or written. Those are separate,
  gated execution paths that do not exist in this change and
  would need their own approval, revalidation, and tenant gates.
- No live seller, no Shop Pay partnership, no Shop backend
  handling, no Muse distribution, and no platform access for
  other businesses is provided or claimed here. Each other
  business's store would need its own authorized connection
  (its own custom app / OAuth install, its own token, its own
  tenant check) — never a shared token across companies.

## What is NOT proven by this change

- No live Shopify read (no real store has been read through
  this client; all tests use a mocked query transport).
- No live seller, no live store, no live price or stock.
- No verified store domain, token, or seller — a store-owner
  call is pending, and nothing about that call's outcome is
  claimed here.
- No endpoint/version live verification: the query documents
  follow the standard Storefront API product/variant/Money
  shape, but that shape has **not** been verified against a
  real Shopify store by this change. The first real read, when
  it happens, must be verified separately and the doc updated
  with its evidence — not assumed from this code.
- No deployment of this code and no CI result for the new HEAD
  (CI is not claimed here; see the commit report).

## Tests

- Full suite: `apps/api/test/shopify-catalog.test.ts` (mocked
  query transport only) — missing token, missing client,
  tenant mismatch, missing store domain, successful mocked
  read with raw IDs stripped, stale/missing-price/out-of-stock
  handling, single-product read, query-only construction with
  mutation rejection, config defaults and validation.
- CI-listed gates: `.github/workflows/ci.yml` was not modified
  in this change, so the fail-closed gates are also appended
  to the already CI-listed
  `apps/api/test/provider-readiness.test.ts`, which CI runs.
  The full suite should be added to `ci.yml` by a later change
  that is allowed to touch it; until then, the standalone file
  is run locally, not claimed as CI-covered.

See also: `docs/meta/meta-catalog-client.md` (the Meta catalog client
this pattern mirrors), `docs/operations/live-readiness.md`
(credential-gated live activation points),
`docs/submission/indie-submission-brief.md` §2 (Meta catalogs and the
still-open first real seller).
