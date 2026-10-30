# Muse Reel interpretation harness — Muse Shopping Index

## Read first: TEST harness, not a live call

Muse Shopping Index is a **Muse feature, not a storefront**. This
harness shows Muse interpreting a Reel and ending in a
server-validated exact review — or being rejected — without ever
letting model text, a caption, or an image description supply a
seller fact. It makes **no** network call, **no** Meta API call,
**no** model call, and runs **no** probe. No credential is used,
stored, or needed. Everything here is TEST until a live catalog
read, a live panel host, and a live seller exist — none of which
are verified.

## 1. The rule, in one paragraph

A Reel observation (what the Reel shows, its caption, an audio
hint) is **untrusted input**. It builds an intent *candidate*:
search terms, plus a caption price recorded only as an untrusted
claim. A caller-supplied catalog record is the **only** source of
facts. If the terms match the catalog title, the record is fresh
(24h) and available, and no caption price contradicts it, the
result is eligible for exact review — with the catalog's title,
price, and currency, and nothing from the candidate. Otherwise the
result is drift (caption price contradicts catalog) or
unverifiable (no catalog, stale, unavailable, title mismatch, or
no terms), and no exact review may be built from it. An eligible
result still requires a consumer approval and executes nothing.

## 2. The real ENRG Reel case

Files: `apps/demo/src/muse-reel-interpretation.ts`,
`apps/demo/test/muse-reel-interpretation.test.ts` (run by the demo
package's `test` script, `tsx --test test/*.test.ts`, which CI runs
for `@gift-signal/competition-demo`).

Input, as supplied by the user — screenshot / upload evidence only:

- Instagram reel `Deo7I3cR7Wq`, 5.775s screen recording, person
  wearing dark ENRG apparel.
- theenrg.com screenshots listing the ENRG Unisex Oversized
  T-Shirt at $44.00 USD.
- No caption was supplied with this Reel, so none is invented in
  the observation (`ENRG_REEL_OBSERVATION`).

Cases, all in the test file:

| Case | Input | Outcome |
| --- | --- | --- |
| (a) Match | Reel apparel + catalog $44.00 USD, fresh, available | `eligible_for_exact_review`: title + $44 + USD from the catalog only, `approvalRequired: true`, `executed: false` |
| (b) Mismatch | Caption $199 vs catalog $249 | `drift_reapproval_required`: catalog $249 wins, `draftSigned: false`, `approvalConsumed: false` |
| (b2) ENRG mismatch | Caption $199 vs catalog $44 | Same drift shape, catalog $44 wins |
| (c) No catalog | Reel, no catalog record | `unverifiable` (`no_catalog_match`), fail closed, no draft, no approval consumed |
| Stale / raw IDs | Stale record; caption with `gid://`, `myshopify.com`, `acct_` | Stale → unverifiable; raw IDs stripped before terms are extracted, and no result carries an ID field |

## 3. Labelling limits — do not soften these

- **Reel-to-exact-SKU match is NOT independently verified.**
  Every eligible result carries `skuMatchVerified: false`. The
  honest description is "Reel terms match the catalog title", never
  "this Reel is proven to be this exact SKU". A live SKU proof
  would need a verified catalog link for that Reel, which does not
  exist in this harness.
- **$44.00 USD is a screenshot price, not a live read.** It is a
  caller-supplied catalog record in the test, labelled TEST wherever
  shown. It is not a live Shopify Storefront read and not a live
  Meta catalog read.
- **No live Meta claim.** This harness does not claim a live Meta
  Model API call, live Reel ingestion, native Meta distribution,
  or a signed Reel callback. The intended production path,
  documented only, is: Meta Model API interprets the Reel →
  candidate terms → read-only, tenant-scoped catalog read (Meta
  catalog or Shopify Storefront, raw IDs stripped) → this same
  verification → server-owned signed draft → exact review → one
  consumer approval → server execution. That path needs its own
  authorizations and is not run here.
- **Approval is never granted by interpretation.** An eligible
  result is a draft for exact review, not an approval, not an
  order, not a payment, and not a shipment.

## 4. What this does NOT change

- No model, caption, or browser input can sign a draft, consume an
  approval, or supply a seller title, price, or stock level.
- No catalog, seller, payment, or Shop integration is created.
- No secret, token, or credential is in this code, its tests, or
  this doc.
