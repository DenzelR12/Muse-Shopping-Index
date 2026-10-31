# Product 100% checklist — Muse Shopping Index

## Read first: two different 100%s

Muse Shopping Index is a **Muse feature, not a storefront**. The panel
is mounted by a Muse host inside a Muse window/surface; no seller gets
a shop site, cart page, checkout page, or product-listing site from
this project.

- **Code-100%** = every internal gap that can be closed in code is
  closed, tested, and documented, with CI-listed gates where possible.
  This batch aims at code-100% and reports it honestly.
- **Live-100%** = code-100% **plus** real Postgres, a real THEENRG.COM
  read, a real ClutchAgent Meta read, a real-browser run, a test-mode
  end-to-end order, a decided business model, Meta distribution, a
  Shop Pay partnership, and real money. Live-100% is **not** achieved
  in this batch and **cannot** be achieved in code alone: it depends
  on a user-only card, owner-supplied tokens and products, an owner
  business-model decision, and external Meta / Shop approvals.
  **Code-100% is not live-100%, and nothing in this doc claims it is.**

Corrected mapping (user correction, 2026-10-27, non-negotiable):
THEENRG.COM = the Shopify side; ClutchAgent = the Muse Meta side;
**both use Muse Shopping Index as the platform** — same core
Reel → Muse window → exact review → one approval → server
execution, different provider adapters (Shopify Storefront read-only
for THEENRG, Meta catalog read-only / Reel entry for ClutchAgent).
ClutchAgent is NOT a Shopify seller and NOT a service checkout
product. No ClutchAgent service price, term, or entitlement exists
in this repo.

## Status key

- **Done in code** — implemented, tested locally, CI-listed gate
  where stated; still needs a live run to become live evidence.
- **Code-ready, not mounted / not live** — pure module + tests exist;
  the live wiring, traffic, or run that would make it live has not
  happened and is listed as the blocker.
- **Blocked external** — cannot be done by Muse code alone; owner is
  named. Do not re-label these as Done.

## Checklist

| Item | Status | Evidence (HEAD / test / file) | Owner |
| --- | --- | --- | --- |
| THEENRG.COM Shopify read adapter (Storefront, query-only, no Admin API, no cart/checkout) | Done in code | `apps/api/src/shopify-catalog.ts`, `apps/api/test/shopify-catalog.test.ts` (9/9 mocked, per earlier batch); provider-readiness gates | Muse |
| ClutchAgent Meta read adapter (Graph, GET-only, read-only in code despite broader scope) | Done in code | `apps/api/src/meta-catalog.ts`, `apps/api/test/meta-catalog.test.ts` (8/8 mocked, per earlier batch); provider-readiness gates | Muse |
| Reel entry contract + simulator (signed intent only, creates nothing; real gate HMAC 410/401) | Done in code | `docs/platform/muse-entry-contract.md`, `apps/demo/src/muse-entry-simulator.ts` | Muse |
| Exact review (seller, item/config, ship-to or access, shipping, tax, total, currency, timing, refund terms; Saved payment / Shop Pay · Saved payment only, no digits, no raw IDs) | Done in code | `apps/demo/src/muse-feature-panel.ts`, panel tests; `apps/api/src/muse-agent-host.ts` | Muse |
| Approval consume-once (bound to exact terms, second click ignored, buy guard) | Done in code | Panel + host tests; `apps/api/src/muse-panel-host.ts` | Muse |
| Drift / expiry → reapproval (changed/expired → new draft + diff in words + fresh approval, old approval gone, never fresh Buy) | Done in code | `apps/api/src/muse-abandoned-recovery.ts`, recovery tests | Muse |
| Resume-by-draft (revalidate first; present_review / reapproval_required / execution_state, never second execution) | Done in code | `apps/api/src/muse-abandoned-recovery.ts`, host resume tests | Muse |
| Reminder, server only (opt-in record, one generic reminder, one-tap opt-out/dismiss, no price/seller/pitch, no retargeting) | Done in code, no channel | `apps/api/src/muse-reminder.ts`, `apps/api/test/muse-reminder.test.ts`; panel opt-in entry exists | Muse (code) / User (channel) |
| Live reminder channel (an authorized channel registered at startup) | Blocked external | No channel configured; sending fails closed by design | User |
| Muse feature panel (real DOM, reading order, aria-live, pre-expiry final 2 min, diff in words) | Done in code | `apps/demo/src/muse-feature-panel.ts`, panel tests 9/9 | Muse |
| Panel host wiring (panel callback → existing server method, principal-only, token from session only) | Done in code | `apps/api/src/muse-panel-host.ts`, host tests + provider gate | Muse |
| Panel routes, pure handler logic (fail-closed 401/403/400/422, no handler on refusal) | Done in code | `apps/api/src/muse-panel-routes.ts`, routes tests + provider gate | Muse |
| Panel mount adapter (principal + server-owned draft + session token resolver, injected deps, no body token/price/title) | Done in code | `apps/api/src/muse-panel-mount.ts`, `apps/api/test/muse-panel-mount.test.ts` (4/4), provider gate (this batch) | Muse |
| Panel routes mounted in `apps/api/src/index.ts` (live HTTP route) | Code-ready, not mounted | **Blocker, precise:** index.ts has no panel session store mapping an authenticated session to an approval token per draft, and the /v1/muse/agent host is per-request, not a panel session. The mount adapter above is ready; wiring it in requires that session store first. See `docs/platform/live-panel-routes-design.md` §5. No live panel-to-API traffic is claimed. | Muse (session store design) / User (host decision) |
| Production host passing bound methods to the panel | Code-ready, not live | Adapter + wiring exist; no production host does this yet | Muse / User |
| Multi-company isolation (THEENRG vs ClutchAgent Meta: cross-tenant catalog/draft/BI rejected, drift affects only its own tenant, BI tenant-trimmed, verified only, one per draftId) | Done in code | `apps/api/src/muse-multi-company.ts` (13/13), `apps/demo/src/muse-multi-company-demo.ts` (9/9), provider-readiness gates (this batch) | Muse |
| BI tenant trim (trim before aggregation, company mismatch 403, watermark only on verified success, forensics + proposed-only remediation) | Done in code | `apps/api/src/muse-bi.ts`, `apps/api/src/muse-bi-store.ts` | Muse |
| Locale gate (profile → device, location never language, caption never supplies facts, unverified/model translation never presented; amounts canonical server) | Done in code (demo step machine; production host wiring of consumerLocale still needed) | `apps/demo/src/muse-commerce.ts`, locale tests; `docs/research/locale-implementation-2026-10-27.md` | Muse |
| Accessibility panel (real text, screen-reader order, amount-labelled approval, diffs in words, generous expiry + pre-expiry warning) | Done in code, no standard claimed | Panel code + `docs/research/accessibility-abandoned-recovery.md` §8; no WCAG audit claimed | Muse |
| Training preparation (synthetic scenarios only, no model trained) | Done in code | `training/muse-commerce/` 48 teaching / 30 held-out, `--check` | Muse |
| README / brief (runnable-first root README, indie brief, technical README) | Done in code | `README.md` (77 lines at 57cc2f), `docs/submission/indie-submission-brief.md`, `docs/technical/README.md` | Muse |
| Render Postgres (muse-shopping-index-db, PostgreSQL 18, Oregon, $10.50/mo config) | Blocked external | No DB created; DATABASE_URL not set/linked; live root still `persistent_rate_limit_not_configured` at last check | User (card; $1 temporary authorization only, no charge claimed) |
| THEENRG.COM real store / product / Storefront token (live read) | Blocked external | Real store, product, price, and token NOT verified; TEST fixtures only in code; ownership (user's own vs store-owner's) unclarified | User / store owner (token to secret manager only, never chat/repo) |
| ClutchAgent real Meta catalog / System User / token (live read) | Blocked external | Real catalog, System User, token NOT verified; Catalog API Calls were 0 at last screenshot; TEST fixtures only | User (Meta dashboard) |
| Meta Business Verification / App Review for advanced catalog_management | Blocked external | Not in this batch; needs legal name/address exact, official valid PDF, phone/email/domain verification, completed app settings, successful API call within 30 days, testing instructions, per-permission screencast showing read-only use | User / Meta |
| Business model (who pays, for what) | Decided 2026-10-31 | `docs/research/business-model-options.md` — option A: sellers pay a fee only on a verified order; fee level unset, no fee/revenue figure claimed | User |
| Meta Reels distribution / signed Reel callback / deep-link contract | Blocked external | Contract + simulator only; distribution approval and signed callback not obtained | Meta |
| Shop Pay partnership / Shop backend / identity, webhooks | Blocked external | Shop Pay vehicle in code (gated, Stripe + Shop Pay, default Stripe); partnership, backend, identity, webhooks not evidenced | User / Shopify/Shop |
| Real-browser run (panel in a real browser: approve, resume, reapproval, reconciliation) | Blocked external | Protocol in `docs/operations/technical-verification-checklist.md`; run not yet done (needs real Postgres + host binding) | User / Muse (joint) |
| Test-mode end-to-end order (THEENRG + ClutchAgent test tenants, signed draft, exact review, approval, status, resume, drift) | Done in code (pure demo), not live | `apps/demo/src/muse-multi-company-demo.ts` (9/9); local verification summary in this batch's workspace evidence (parent-held), NOT a live order | Muse (code) / User (live run) |
| Demo 90s cut (re-assembled with new-style mockups + full narration, failure/reapproval case) | Remaining Demo item, untouched in this batch | Existing cut uses backpack reapproval mockup + 36.6s narration + silent holds; re-assembly was explicitly skipped by user and "Get it to 100%" is not a specific Demo authorization | User (re-authorization) |
| Render Starter upgrade ($7/mo, judging window, spin-down fix) | Remaining Demo item, untouched in this batch | NOT approved; Free plan spins down (50s+ first request) | User |
| Submission package (brief + video + live URL story, honestly labelled) | Remaining Demo item | Brief is code-ready; video and live URL depend on Demo items above | User / Muse |

## What code-100% now covers

After this batch, every internal gap that can be closed without a
live secret, a live token, an owner decision, or an external approval
is closed in code: panel routes have a mount adapter, multi-company
gates are CI-listed, the multi-company demo runs pure and
deterministic, mockup realness is documented instead of faked, and
this checklist names the owner of every remaining item.

## What code-100% does NOT cover

It does not cover: a live database, a live catalog read of any kind,
a live seller, a live payment, a live Shop handling, a live reminder,
a native Muse window, a live panel route, a decided business model,
Meta distribution, a Shop Pay partnership, or real money. Any claim
that code-100% equals live-100% would be false, and this doc is the
record against that claim.

## Remaining code gap, stated plainly

Exactly one internal code gap remains after this batch: the panel
session token store. The mount adapter is ready and tested, but
index.ts cannot wire it in until a server-owned store maps an
authenticated panel session to an approval token per draft. Until
that store exists and is wired, panel routes stay code-ready, not
mounted — and that is the correct fail-closed state, not a defect to
be worked around by reading a token from the body.
