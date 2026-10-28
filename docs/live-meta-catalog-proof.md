# First live Meta catalog read — proof

**Date verified:** 2026-10-28, 15:48 EDT
**Method:** Meta Graph API Explorer, read-only GET, Graph API v26.0
**Endpoint shape:** `GET /{catalog-id}/products?fields=id,name,price,currency,availability`
**Tenant:** ClutchAgent (TEST tenant, Muse Meta side)
**App:** `muse shop index` (Meta app inside Muse Shopping Index)
**Token:** JoeBlow System User, Muse Shopping Index portfolio, `catalog_management` permission, via the ClutchAgent → Muse Shopping Index partner share of the ClutchAgent Test Catalog. The token value is never in this repo, in chat, or in a screenshot. No token, secret, or credential appears in this document.

## Screenshot proof (redacted)

![Live Graph API Explorer read — catalog ID and product ID blacked out, including in the paging URLs](live-meta-catalog-proof.jpg)

Catalog ID and product ID are blacked out in the query, in the returned item, and in the paging URLs. No access token appears in the screenshot (Explorer shows "Unavailable in session"). Pagination cursors remain visible; they are not IDs or tokens and cannot be used without a token.

Note: this image is binary and cannot be pushed through this connector, so it must be added via direct git as `docs/live-meta-catalog-proof.jpg` for the embed above to render. The written record below is complete without it.

## What was returned (redacted)

One item in `data`:

- Name: **Test - ClutchAgent Access**
- Price: **$1.00**
- Currency: **USD**

Catalog IDs, product IDs, paging cursors, and paging URLs from the raw response are redacted in this public proof. The original screenshot is held by the project owner and is not committed here, because it contains those raw IDs.

A prior authentication check the same day returned JoeBlow for `/me` in 152 ms, proving the token authenticates as that System User before the catalog query ran.

## What this proves

- The JoeBlow token authenticates and carries catalog access.
- The ClutchAgent → Muse Shopping Index partner share works: a token from the app-owner portfolio can read the ClutchAgent catalog.
- The catalog ID configured in Render matches a real catalog with a real product.
- Title, price, and currency validate — the three fields the read-only catalog client requires.

## What this does NOT prove

- Availability was not visible in the returned JSON in the proof screenshot, even though Commerce Manager showed the item In stock separately. Do not claim availability was verified from this Graph response alone.
- This was a Graph Explorer read. It is **not** a read through the repo's `meta-catalog.ts` client, and it is **not** a Render API route serving that read. Those remain to be verified separately.
- It is **not** a live seller, a live payment, a native Reel button, or Reels distribution. The item is a labelled TEST item with a test price, not a real ClutchAgent service price.
- It does not change the fail-closed panel routes, which still refuse every request until panel sessions, draft lookup, and host methods are wired.

## Chain that made this read possible

1. ClutchAgent Test Catalog created in the ClutchAgent Business Portfolio, with one TEST item, Eligible, In stock (Commerce Manager).
2. ClutchAgent shared that catalog (Full access in Meta's partner UI) with the Muse Shopping Index portfolio — required because the app is owned by Muse Shopping Index, not ClutchAgent, so ClutchAgent's System Users page stayed greyed out.
3. JoeBlow System User in the Muse Shopping Index portfolio, assigned the shared catalog, token generated with `catalog_management`.
4. Token stored in Render as `META_CATALOG_ACCESS_TOKEN` and catalog ID as `META_CATALOG_ID` (names verified in Render Environment, 2026-10-28 15:18–15:19 EDT; values never read or copied).
5. Graph API Explorer read with that token, v26.0, returned the item above.
