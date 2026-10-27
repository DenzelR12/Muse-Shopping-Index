# Mockup realness — what AI mockups are, and what a real screenshot is

## Read first

Muse Shopping Index is a Muse feature, not a storefront. Its panel is
a real DOM panel mounted by a Muse host inside a Muse window/surface
(`apps/demo/src/muse-feature-panel.ts`). That panel code is real.
AI-generated mockup images of that panel are **not** real screenshots,
however clean they look, and they must never be presented as if they
were.

## Why AI mockups are NOT real screenshots

An AI mockup image is generated from a text prompt. It can:

- invent an order number, a payment digit, a view count, a date, or a
  product name that was never in any catalog, draft, or order;
- show totals whose parts do not add up (for example, a reapproval
  mockup whose item price and shipping do not sum to its total, or
  whose shipping is shown as both changed and unchanged);
- rename a product between frames (Aurora in one frame, a different
  name in the next) while keeping the same totals;
- render a payment label with digits, which the product rule forbids:
  consumer payment labels are exactly "Saved payment" (Stripe) and
  "Shop Pay · Saved payment" (Shop Pay), with no digits.

All of those artifacts have appeared in this project's mockups, and
they were caught by reading the images, not by trusting the prompt.
A prompt that says "no invented details" does not make the output
real; it only makes the next artifact harder to spot. That is why
this batch regenerates **no** AI mockups to fake realness.

## What a real panel screenshot run is

A real screenshot is a capture of the actual panel code rendering
actual server-validated state, in a real browser. It requires, in
order:

1. **Real Postgres** (Render `muse-shopping-index-db`, DATABASE_URL
   linked) — so drafts, approvals, and status are persisted, not
   in-memory demo state. Blocked: user-only card.
2. **Test tenants with test products** — THEENRG.COM (Shopify,
   Storefront read-only, TEST product) and ClutchAgent (Meta,
   catalog read-only, TEST product), each with its own manifest and
   catalog connection, tenant-isolated. Code exists; real tokens
   and products are owner-supplied and still unverified.
3. **A production host passing bound methods** to the panel
   (`createMusePanelHostHandlers` + the mount adapter in
   `apps/api/src/muse-panel-mount.ts`), with a panel session token
   store (the one remaining code gap in
   `docs/product-100-checklist.md`). Until that store exists, a
   panel route cannot be mounted, and a real-browser panel run
   cannot go through a live route.
4. **A real-browser run, step by step, with evidence recorded:**
   - Reel entry → exact review (seller, item, shipping, tax,
     total, currency, timing, refund terms, "Saved payment" only)
   - Approve once → processing, second tap ignored → owned status
     ("Tracking is not available yet" when no tracking exists)
   - Resume after the chat closes → revalidation first →
     present_review, or new draft + diff in words + fresh approval
     on drift/expiry, or execution state when already approved
   - Drift case: price change → reapproval required, old approval
     gone, totals in words
   - Cross-tenant check: a THEENRG draft is not visible to a
     ClutchAgent principal, and vice versa
   - For each step, record: the URL/host, the draft state, the
     timestamp, and what was *not* shown (no order number invented,
     no payment digits, no tracking invented, no date invented).
5. **Labelling:** a real panel render is labelled "REAL PANEL
   RENDER — test tenants, test products, no real money" and is
   saved workspace-only unless and until it is verified as a
   submission asset. An AI mockup is always labelled "DEMO" and
   never relabelled as real.

## Checklist for that run (copy this into the run record)

- [ ] Postgres live and DATABASE_URL linked; root no longer returns
      `persistent_rate_limit_not_configured`
- [ ] THEENRG TEST product read from a real catalog connection
      (title/price/currency/stock verified, IDs stripped, TEST)
- [ ] ClutchAgent TEST product read from a real catalog connection
      (same checks, TEST)
- [ ] Panel renders in a real browser from panel code, not from an
      image generator
- [ ] Approve → processing → status, with second tap ignored
- [ ] Resume → revalidation → present / reapproval / execution state
- [ ] Drift → reapproval, old approval gone
- [ ] Cross-tenant isolation checked in the browser run
- [ ] No order number, payment digit, tracking, or date appears
      unless it came from verified server state
- [ ] Screenshots saved with a run record (date, host, tenants,
      draft states) — not as standalone images with no provenance

## What this batch did instead of faking it

- No AI mockup was regenerated in this batch.
- The existing new-style mockups (white/blue-outline, DEMO badges)
  remain workspace-only, labelled DEMO, with their known artifacts
  recorded in the parent's memory (synthetic order number in the
  first set; inconsistent payment digits; wrong-year date; second
  set: fake view counts, renamed product, inconsistent reapproval
  math). They are drafts for style, not evidence.
- If a real panel render is captured later, it must be captured by
  the run above, saved workspace-only, and labelled REAL PANEL
  RENDER — never by regenerating an AI image and relabelling it.
