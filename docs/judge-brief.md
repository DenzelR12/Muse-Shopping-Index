# Muse Shopping Index — Judge Brief

## What it is, in one line

You tap **Shop this reel** on a Reel, a Muse window opens, you review
the exact purchase, you approve it once, and the server executes it.
That is the whole product. It is a **Muse feature, not a storefront**:
there is no shop site, cart page, checkout page, or product-listing
site, and the review panel only ever appears inside a Muse window or
surface, mounted by a Muse host.

## Why it is called an index

It does not own inventory or sell its own goods. It keeps a clean,
up-to-date, per-seller record of other sellers' goods — what each item
is, who sells it, what it costs, and whether it is in stock — so Muse
can look a Reel up in seconds and resolve it to one exact, verified
item before any approval. A caption never overrides a catalog entry:
a stale, unverifiable, or out-of-stock entry is unavailable, and a
price mismatch forces reapproval. Today that index exists as code and
test data, plus one verified live read: on 2026-10-28 a Graph API
Explorer read returned the ClutchAgent TEST item ($1.00 USD) — see
[docs/live-meta-catalog-proof.md](live-meta-catalog-proof.md). That read
is not yet a read through the repo client or a Render route.

## Try it first (live demo, no sign-in, no backend)

**https://denzelr12.github.io/Muse-Shopping-Index/demo/**
(verified live 2026-10-28, published from main, folder /docs)

1. **Reel 1 — THEENRG, a product.** Tap the small product thumbnail
   (the black ENRG tee, $44.00 USD) or **Shop this reel in Muse**.
   Review the exact terms — seller THEENRG.COM, item, shipping and
   tax (demo examples, see below), total $52.52 USD — then
   **Approve $52.52** and watch Processing → Shipped → Delivered.
2. **Try the safety case.** In Product Review, tap
   **Test price change (TEST)**. The total moves $52.52 → $54.52
   (item $46.00 + shipping $5.00 + tax $3.52). The old approval does
   **not** execute and no payment is taken at the old price. You must
   **Reapprove $54.52** to continue, or **Cancel** to return to the
   $52.52 review with nothing executed.
3. **Reel 2 — ClutchAgent, a service.** Scroll down, tap its thumbnail
   or **Shop this reel in Muse**. Same workflow, different outcome:
   service access delivered in Muse, not a shipment — no shipping, no
   door delivery, no tracking, and no price is shown, because no
   ClutchAgent service price has ever been supplied and none is
   invented here.
4. **For business (last tab).** How the connector helps a seller:
   verified sales, not just likes — a full funnel, Reel tap →
   Review → Approved → Shipped → Delivered, with no double-counting
   and refunds subtracting. The numbers shown are a one-order demo
   example, not THEENRG's real sales.

## The safety model (why this is not just a checkout button)

- **Exact review, one approval.** The consumer approves exact terms
  (seller, item, price, shipping, tax, total, currency, payment
  timing, refund terms). Approval is consumed once.
- **Drift means reapproval.** Any change to price, tax, shipping,
  terms, or payment authority invalidates the old approval. The old
  approval never executes at a new price.
- **The model proposes; the server decides.** Model text, captions,
  and browser input can never grant approval, sign a draft, or
  supply seller facts. Only the deterministic server authorizes and
  executes, against server-owned, signed draft state.
- **Fail closed on raw IDs and uncertainty.** Raw provider IDs are
  stripped or rejected in consumer output. If completion is
  uncertain, the system reconciles — it never blindly retries or
  charges twice.
- **Tenant isolation.** A company only ever sees its own data and
  drafts. One seller's token, catalog, or report never leaks into
  another seller's view.
- **No payment without a human.** No real-money transaction happens
  without an explicit approval of that exact transaction.

## What is code-ready vs what is actually live — honestly

| Area | Status |
| --- | --- |
| Interactive demo (above) | **Live** on GitHub Pages, static, no backend. It proves the flow and the safety case; it is not a real purchase. |
| Exactly-once guard (`muse-exactly-once.ts`) | **In code, tested 8/8 locally.** Atomic Postgres claim per tenant + key, duplicate replay returns the original result, stale claims reconcile never auto-retry, burst limiter fails closed. Not a live route, not a 10,000-request load test, no scaled host/queue yet — see [docs/muse-exactly-once.md](muse-exactly-once.md). |
| Panel session token store + mount adapter | **In code, CI-gated.** Server-owned draft → approval-token store (memory + Postgres), fail-closed on missing, mismatched, expired, or consumed tokens. |
| Panel routes in `index.ts` | **In code, fail-closed only.** The four dispatch branches exist, but every request refuses today (503 without a database, 400 without an authenticated panel session), because session issuance, a real draft lookup, and real host methods are not wired yet. No handler is ever called through them. |
| Live panel route, live Postgres, live seller, live payment | **Not live, except one Graph Explorer catalog read.** No live panel-to-API traffic, no live Shopify catalog read, no live Shop Pay execution, no native Muse distribution. First live Meta catalog read (ClutchAgent TEST item, $1.00 USD, 2026-10-28) is proved in [docs/live-meta-catalog-proof.md](live-meta-catalog-proof.md). |
| Measured chat-to-door time | **Not measured.** No tap → approval → verified order → delivered timestamps exist yet, because no real seller test has run. No time is claimed. |
| Business model | **Undecided.** Who pays, and for what, is not yet decided. This brief does not invent one. |
| Reel-to-SKU match | **Not independently verified.** The ENRG Reel and the $44 tee match by the terms shown, but the exact SKU link has not been verified against a live catalog. |

Numbers to read as demo, not as facts: shipping $5.00 and tax $3.52
are demo examples (the store page said shipping is calculated at
checkout and tax was not available); Reel engagement counts are
user-supplied, not verified Reel statistics; the $54.52 drift total
is a test example. No order number, delivery date, tracking number,
or carrier fact in the demo is real.

## How this maps to the rubric

- **Impact (30%)** — Fewer clicks from Reel intent to door delivery,
  for products and for services, with the business side seeing
  verified orders instead of likes. Proved in the demo; still
  missing: one real seller in test mode with measured timestamps.
- **Meta AI (25%)** — The flow is built around Muse: Reel intent
  becomes a Muse review, and a Reel-interpretation harness shows a
  match going to exact review while a price mismatch (caption $199
  vs catalog $249) is rejected with no draft and no approval. Still
  missing: a live, measured Muse interpretation against a live
  catalog.
- **Technical (20%)** — Deterministic server authorization, signed
  drafts, consume-once approval, drift reapproval, tenant isolation,
  and a fail-closed panel mount that refuses rather than invents.
  Still missing: the full live wiring (session issuance, draft
  lookup, host methods) and a live Postgres-backed run.
- **Demo (25%)** — A live, clickable Reels feed with both a product
  and a service, product thumbnail tags like Instagram, and the
  price-change safety case, all demo-labelled. Still missing: a real
  seller test run to replace demo numbers with measured ones.

## In short

The idea is complete and clickable today, the safety rules are in
code and tested, and the gaps are named above rather than hidden.
What would turn this from a strong demo into a winning entry is one
real seller in test mode, one measured end-to-end run, and the
remaining live wiring — in that order.
