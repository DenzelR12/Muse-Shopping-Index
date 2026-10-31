# Muse Shopping Index — Judge Brief

**Watch the pitch (2:57):** [Muse Shopping Index — pitch video](https://denzelr12.github.io/Muse-Shopping-Index/muse_demo-video.MP4)


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
test data, plus verified live reads of the ClutchAgent Test Catalog:
a Graph API Explorer read on 2026-10-28, and — since 2026-10-30 — a
read through the repo client itself (`apps/api/src/meta-catalog.ts`)
running on Render, with all eight verification checks passing
(title, price, currency, availability, freshness, raw IDs stripped)
— see [docs/meta/live-meta-catalog-proof.md](../meta/live-meta-catalog-proof.md),
including the 2026-10-30 addendum and the shell screenshot. TEST
catalog, Development Mode, read-only: not a commercial seller.

## Try it first (live demo, no sign-in)

**https://denzelr12.github.io/Muse-Shopping-Index/demo/**
(demo v70, verified live 2026-10-31, published from main, folder /docs)

Disclosure, up front: **the five demo Reels are AI-generated studio
clips made for this demo.** The products, prices, and catalog photos
in them are the real THEENRG items, and the grounding measurements
below were run against these clips frame by frame. In production,
the same flow runs on a seller's real Reels.

1. **Reel 1 — THEENRG, products that ship.** Tap **Shop this reel
   in Muse**. The demo calls the production API and **Muse Spark
   watches the reel live** — six frames, server-side — and the "How
   Muse matched this Reel" card shows the model's actual verdict
   and the server's verification of it. The model also receives both products' catalog photos and the reel's seller tag as a claim to verify — on Reel 1 the tag checks out against the frames; on the second clip it does not, which is part of why Muse asks. On this clip the tee
   dominates four of the six frames at high confidence, so you
   continue to the exact review — seller THEENRG.COM, total
   $52.52 USD (demo terms, see below) — then **Approve $52.52** and
   watch Processing → Shipped → Delivered. Scroll to the second
   THEENRG clip and tap Shop again: there the verdict is
   **UNCERTAIN** — both products appear with no single clear
   focus — so Muse asks "Which one?" first, the safety picker.
   Neither verdict is staged: both were measured live on
   2026-10-31, are cached for 24 hours, and are re-measured on
   expiry (docs/meta/meta-model-reel-watch.md). If the model API
   is ever unreachable, the demo says so and falls back to the
   picker rather than guessing.
2. **Try the safety case.** In Product Review, tap
   **Test price change (TEST)**. The total moves $52.52 → $54.52
   (item $46.00 + shipping $5.00 + tax $3.52). The old approval does
   **not** execute and no payment is taken at the old price. You must
   **Reapprove $54.52** to continue, or **Cancel** to return to the
   $52.52 review with nothing executed.
3. **Reel 2 — Travel, tickets that open at the gate.** On the
   Starfall Park Reel, tap Shop: the **"A few details, all at
   once"** screen asks for the date on a November 2026 calendar
   and the guests (Adults / Children steppers) together, then
   **Continue to exact review** — the same flow and terms as the
   pitch video: Starfall Park (fictional demo park); Sat, Nov 14,
   2026; 2 adults; $119.00 × 2 + $15.47 tax = **$253.47 USD**;
   mobile tickets in Muse, no shipping. **Change date or
   guests** returns to the calendar and every screen recomputes
   (Sat Nov 21 + 1 child = $380.21). Approve → "Booking your
   tickets…" → **Tickets confirmed** (Add to Apple / Google
   Wallet, day-of reminder) → the ticket in Muse ("Demo ticket,
   not valid for entry").
4. **Reel 3 — ClutchAgent, a service.** Two clips. Tap **Shop this
   reel in Muse**. Same workflow, different outcome: service access
   delivered in Muse, not a shipment — no shipping, no door delivery,
   no tracking. The price shows "To be confirmed at review," because
   no ClutchAgent service price has ever been supplied and none is
   invented here.
5. **For business (last tab).** How the connector helps a seller:
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
| Interactive demo (above) | **Live** on GitHub Pages. The feed and panels are static files, but the demo is not backend-free: the THEENRG Shop buttons call the production API's live Muse Spark grounding route, and the page checks live API status on load. It proves the flow and the safety case; it is not a real purchase. |
| Demo grounding route (`POST /v1/demo/reel-grounding`, `GET /v1/demo/status`) | **Live** on the production API (Render). Reel-id enum input only; server-held frames; Muse Spark verdict admitted only through the fail-closed grounding module; 24-hour cache, 20 fresh calls/hour budget; CORS scoped to the demo origin. Read-only: it cannot approve, sign, or execute anything. |
| Exactly-once guard (`muse-exactly-once.ts`) | **In code, tested 8/8 locally.** Atomic Postgres claim per tenant + key, duplicate replay returns the original result, stale claims reconcile never auto-retry, burst limiter fails closed. Not a live route, not a 10,000-request load test, no scaled host/queue yet — see [docs/platform/muse-exactly-once.md](../platform/muse-exactly-once.md). |
| Panel live wiring (`muse-panel-live-wiring.ts`) | **In code, CI-gated.** Draft registry (Postgres + memory), server-side session issuance, live host adapter with tenant + in-flight guards. Panel routes in `index.ts` now resolve drafts instead of returning null — **live traffic still blocked at one gap only: production host binding** (consumer identity + connection + session token from a real Muse host). See [docs/platform/muse-panel-live-wiring.md](../platform/muse-panel-live-wiring.md). |
| Panel session token store + mount adapter | **In code, CI-gated.** Server-owned draft → approval-token store (memory + Postgres), fail-closed on missing, mismatched, expired, or consumed tokens. |
| Panel routes in `index.ts` | **Wired in code, host binding open.** Draft lookup is live via the registry and host methods go through the live adapter; requests still refuse without an authenticated panel session and bound host methods. The remaining gap is production host binding only, not draft lookup or issuance. |
| Live panel route, live Postgres, live seller, live payment | **Not live, except the Meta catalog reads.** The Postgres database itself is live (created 2026-10-28), but no Postgres-backed panel or execution run is verified yet. No live panel-to-API traffic, no live Shopify catalog read, no live Shop Pay execution, no native Muse distribution. Live Meta catalog reads (ClutchAgent TEST item, $1.00 USD) are proved in [docs/meta/live-meta-catalog-proof.md](../meta/live-meta-catalog-proof.md): Graph Explorer on 2026-10-28, and through the repo client on Render on 2026-10-30 (all checks pass). |
| Measured chat-to-door time | **Not measured.** No tap → approval → verified order → delivered timestamps exist yet, because no real seller test has run. No time is claimed. |
| Business model | **Undecided.** Who pays, and for what, is not yet decided. This brief does not invent one. |
| Reel-to-item match | **Verified by the live model path against the demo catalog** (2026-10-31): first THEENRG clip → exact tee, seller tag verified; second clip → picker, tag not confirmed. **Not** yet verified against a live Shopify catalog read of THEENRG — the demo catalog is screenshot-derived. |

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
- **Meta AI (25%)** — **Live in the demo path since 2026-10-31:**
  tapping Shop on a THEENRG Reel calls the production API, and Muse
  Spark (muse-spark-1.3) watches six frames of the Reel plus both
  products' catalog photos, checks the seller's product tag as a
  claim to verify (never as fact), and returns structured JSON. The
  server-side `muse-reel-grounding.ts` module (8/8 tests) admits an
  exact review only on a confident, catalog-verified match; anything
  else goes to the "Which one?" picker or fails closed. **Measured
  live, 2026-10-31:** first THEENRG clip → exact tee at high
  confidence, seller tag verified; second clip → UNCERTAIN → picker
  (the model's raw answer varies between runs on this genuinely
  mixed Reel; the server verdict is stable). Also live: Meta
  catalog API reads of the ClutchAgent TEST catalog through the
  repo client (2026-10-30, all checks pass). Earlier evidence, in
  order: the 2026-10-29 three-frame probe returned UNCERTAIN on the
  mixed Reel — which is why the picker exists; a naive
  color-histogram similarity baseline was tried and rejected (it
  scored the wrong garment higher); CLIP ViT-B/32 (local,
  2026-10-30) identifies each product in isolation (sanity margin
  +0.25) but cannot separate the two studio Reels by featured
  product, corroborating UNCERTAIN. Honest limits: a small number
  of live runs, a two-product demo catalog (screenshot-derived, not
  a live store read), one embedding configuration tested.
- **Technical (20%)** — Deterministic server authorization, signed
  drafts, consume-once approval, drift reapproval, tenant isolation,
  and a fail-closed panel mount that refuses rather than invents.
  Still missing: production host binding for the panel and a live
  Postgres-backed run; session issuance, draft lookup, and host
  methods are in code. New:
  `muse-reel-grounding.ts` takes the model's structured output and
  runs it through catalog verification (tenant check, verified-only
  matching, fail-closed on hallucination), 8/8 tests green.
- **Demo (25%)** — A live, clickable 5-Reel feed with three purchase
  kinds through one flow — a product that ships, travel tickets, and
  a service that unlocks — with product thumbnail tags like Instagram
  and the price-change safety case, all demo-labelled. Still missing: a real
  seller test run to replace demo numbers with measured ones.

## In short

The idea is complete and clickable today, the safety rules are in
code and tested, and the gaps are named above rather than hidden.
What would turn this from a strong demo into a winning entry is one
real seller in test mode, one measured end-to-end run, and the
remaining live wiring — in that order.
