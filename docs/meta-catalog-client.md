# Read-only Meta catalog client — code, gated, not live-verified

Status: client code only. This document describes code that exists in
`apps/api/src/meta-catalog.ts`. It does **not** claim a live Meta
catalog connection, a live read, a live seller, or any Meta approval.
A live read has not succeeded yet, and none is claimed here.

## Hierarchy

- Parent project: **Muse Shopping Index** (this repo).
- Meta app inside it: **muse shop index** (a Meta for Developers app,
  not a separate product, not a rename of the parent project).
- That app has the Catalog API use case added, with the
  `catalog_management` permission showing **Ready for testing** and
  **API Calls 0**. Nothing in this client changes that status.

## What the client does

`readMetaCatalog` is an internal helper — the narrowest API surface.
There is deliberately **no new public route and no public purchase
route** in this change. A future route, if one is ever added, must
authenticate the principal, pass that principal's company as both the
requesting company and the principal, resolve the catalog ID from that
company's own manifest (or `META_CATALOG_ID`), and label its output
READ-ONLY with the source and TEST labels below until a real read is
verified.

Reads, only:

- `GET {base}/{version}/{catalogId}` — catalog details
- `GET {base}/{version}/{catalogId}/products` — catalog products

Base and version are configurable via environment (names only, below)
and default to `https://graph.facebook.com` and `v26.0`.
`v26.0` is the latest Graph API version announced by Meta on
2026-07-29 (Meta developer blog, "Introducing Graph API v26.0 and
Marketing API v26.0", developers.facebook.com). The Meta catalog
reference page itself returned 403 to a plain text fetch during this
work, so the catalog node / products edge shape is the standard Graph
API node/edge pattern and is **not** live-verified against a real
catalog. Do not copy any `https://facebook.com{product_catalog_id}`
endpoint shape from a blog paste: the Graph API base is
`graph.facebook.com` with a versioned path, and this client uses
nothing else.

## Environment variables (names only — never values)

- `META_CATALOG_ACCESS_TOKEN` — System User token, stored only in the
  deployment secret manager (Render, service `muse-shopping-index-api`,
  Environment). Never in the repo, chat, logs, or tests. This client
  reads it from the environment at runtime only; no value was read,
  copied, or used while building this client.
- `META_CATALOG_ID` — deployment-level catalog ID (test catalog).
- `META_GRAPH_API_BASE_URL` — Graph API base, default
  `https://graph.facebook.com` when empty.
- `META_GRAPH_API_VERSION` — Graph API version, default `v26.0` when
  empty.

## Fail-closed behaviour

In order, before any network call:

1. `META_CATALOG_ACCESS_TOKEN` missing → `muse_catalog_not_configured`.
   No approval consumed, no network call.
2. Token present but no startup-registered client →
   `muse_catalog_client_not_registered`. Clients are registered only
   at server startup by the operator, never over HTTP, never from a
   request body, never the synthetic fixture.
3. Requesting company differs from the authenticated principal's
   company → `provider_readiness_company_mismatch` (the existing
   readiness error name). A read is only ever for the authenticated
   company's own catalog.
4. Catalog ID missing (no `META_CATALOG_ID` and no per-company
   manifest catalog ID) → `muse_catalog_id_not_configured`. There is
   never a default catalog, and a catalog is never shared across
   companies: a manifest catalog ID wins over `META_CATALOG_ID`, and
   only for the company that manifest belongs to.
5. Bad base/version configuration → `meta_catalog_config_invalid`.

Config returns presence booleans only; the token travels only in an
`Authorization` header, never in a URL query string, and is never
logged or echoed.

## Read-only rule — despite the scope name

`catalog_management` in Meta's definition allows create, read, update,
and delete of business-owned product catalogs. This client uses only
the read part, in code: its transport has exactly one method, GET;
its client interface exposes exactly two reads; there is no write
method, no write endpoint, and no way to express a write through this
module. A write would require new code, which this module's review
rule forbids. The scope being broader than the client is a reason to
keep the client narrow, not a permission to widen it.

## Validation on read

Items are validated against the existing catalog rules (schema,
title, price, currency, availability/stock where returned):

- Title (`title`, or `name`) required, 1–200 characters.
- Price required and positive, as `"9.99 USD"`, a number plus a
  currency field, or an `{amount, currency}` object; currency must be
  a 3-letter code.
- Availability, where returned, must be a known stock state
  (`in stock`, `out of stock`, `preorder`, `available for order`);
  unknown stock states are unverifiable, not guessed.
- Freshness SLA is 24 hours (the same SLA as `muse-bi.ts`). An item
  carrying a timestamp older than 24 hours — or unparseable, or in
  the future — is **unverifiable / refresh required**: it is listed
  as unverifiable, never presented as current, and its price is never
  guessed. Items with no timestamp are stamped by the read itself
  (`fetchedAt`); the result carries `validUntil = fetchedAt + 24h`,
  after which a fresh read is required.
- Out-of-stock items are valid but unavailable: they go in the
  `unavailable` bucket, not the `verified` bucket.
- Consumer output strips raw provider IDs: only the resolved display
  name/title, price, currency, and availability leave this module.
  Provider catalog, product, and retailer IDs never appear in a read
  result.

Output is labelled on every read:

- `source: 'META CATALOG'`
- `label: 'TEST — Development Mode / test catalog'`

It must never be presented as a live seller's live catalog until a
real read is verified against the deployed service, separately from
this code change.

## What this client never does

- No review is rendered, no draft is signed, no approval is issued,
  no purchase is executed, and no approval is consumed by a read.
- Downstream only: where a review is ever rendered by other code, the
  payment label is exactly `Saved payment`. That rule lives in the
  review path, not in this client, and this client must not be used
  to render one.
- No live seller, no App Review, no Business Verification, and no
  platform access for other businesses is provided or claimed here.
  Those need Business Verification + App Review + per-business OAuth,
  not a shared System User token, and each other business's catalog
  would need its own authorized connection and its own tenant check.

## What is NOT proven by this change

- No live catalog read (no real catalog has been read through this
  client; all tests use a mocked Graph API transport).
- No live seller, no live catalog, no live price or stock.
- No App Review, no Business Verification.
- No platform access for other businesses.
- No deployment of this code and no CI result for the new HEAD
  (CI is not claimed here; see the commit report).

## Tests

- Full suite: `apps/api/test/meta-catalog.test.ts` (mocked Graph API
  transport only) — missing token, missing client, tenant mismatch,
  missing catalog ID, successful mocked read with raw IDs stripped,
  stale/invalid items unverifiable, GET-only construction, config
  defaults and overrides.
- CI-listed gates: `.github/workflows/ci.yml` was not modified in
  this change, so the fail-closed gates are also appended to the
  already CI-listed `apps/api/test/provider-readiness.test.ts`,
  which CI runs. The full suite should be added to `ci.yml` by a
  later change that is allowed to touch it; until then, the
  standalone file is run locally, not claimed as CI-covered.

See also: `docs/live-readiness.md` (credential-gated live activation
points), `docs/muse-entry-contract.md` (Muse/Meta entry contract),
`docs/indie-submission-brief.md` §2 (Meta catalogs: the straight
answer — a live catalog connection is still not done).
