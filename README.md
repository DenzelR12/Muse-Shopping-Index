# Muse Shopping Index

[![CI](https://github.com/DenzelR12/Muse-Shopping-Index/actions/workflows/ci.yml/badge.svg)](https://github.com/DenzelR12/Muse-Shopping-Index/actions)  [Live demo](https://denzelr12.github.io/Muse-Shopping-Index/demo/)  [Judge brief](docs/submission/judge-brief.md)

Tap **Shop this reel** in Muse, review exactly once, approve once, and let the server execute — fewer clicks from a Reel to the door.

## Watch the pitch (2:56)

[![Muse Shopping Index — pitch video](https://img.youtube.com/vi/ND0hfXih8bg/maxresdefault.jpg)](https://www.youtube.com/watch?v=ND0hfXih8bg)

One exact review. One approval. Nothing hidden. Same video on this site: [watch here](https://denzelr12.github.io/Muse-Shopping-Index/muse_demo_video_small.MP4) · [Try the live demo](https://denzelr12.github.io/Muse-Shopping-Index/demo/)

`muse shop index` is the Meta app inside this project — not a separate product, and not a new name for the project.

## In plain English — read this first, no technical words needed

You see something you like in a Reel. You tap **Shop this reel**. A window opens inside Muse and shows you, in one clear list, exactly what you would be buying: who is selling it, what it is, how much it costs in total, where it would go, and how you could get your money back. You say yes once, for that exact list. If the price changes after that, your old yes does not count — you have to say yes again to the new price. Nothing is bought, charged, or shipped without that yes.

**Words used in this README, in plain English:**

- **Seller (tenant)** — one business, like THEENRG.COM or ClutchAgent. Each seller's information is kept separate from every other seller's, so one seller never sees another seller's data.
- **Approval** — your one yes, tied to one exact list of terms. It can only be used once.
- **Reapproval** — saying yes again, because something in the list changed (price, shipping, tax, or terms).
- **Exact review** — that one clear list, shown before you approve, with no hidden fees or changed details.
- **Catalog / index** — the checked list of items a seller offers, with verified prices. Muse looks the Reel up in this list instead of guessing from the video or caption.
- **Fail closed** — if something is unclear, old, or unverified, the system stops and asks again instead of guessing or charging you.
- **Demo / TEST** — a practice version with example numbers, not a real purchase. Real purchases are never claimed from a demo.

Try the live demo first — no sign-in, no money: https://denzelr12.github.io/Muse-Shopping-Index/demo/


- **Reel → Muse window → exact review → one explicit approval → server execution.** Shop handles the post-approval backend where authorized: notifications, verification, email, and shipping updates.
- **Approval is consume-once and bound to exact terms.** A changed price, tax, shipping, configuration, terms, or payment authorization needs fresh approval (reapproval). Uncertain completion goes to reconciliation, never a blind retry or a second charge.
- **Resume by draft, plus one generic opt-in reminder.** Return to an existing owned draft, revalidated first; expired or changed drafts get a new review, a diff, and fresh approval. A reminder is explicit opt-in only, generic, one only, with no price, seller, or pitch.
- **Read-only catalog reads, TEST-labelled.** Meta and Shopify catalog clients are gated, tenant-scoped, and strip raw provider IDs; a read consumes no approval.
- **The model proposes; the deterministic server authorizes.** Model, caption, or browser text never grants approval, signs a draft, or supplies seller facts. Company and consumer data stay tenant-scoped to their authenticated identity.

## Prerequisites — do these before building anything

This is the one section to read first. Nothing below it (clone, build, demo) gives you live Meta, Render, or payment access on its own — the accounts and verifications here are what that access depends on. Order matters: Meta account first, then Business Portfolio, then app, then catalog, then Render, then code.

### Tools and accounts you need

- **GitHub** — account, `git`, and the public repo `DenzelR12/Muse-Shopping-Index`. GitHub Pages (main branch, `/docs` folder) serves the static demo at `https://denzelr12.github.io/Muse-Shopping-Index/demo/`; enabling Pages is a repo Settings action.
- **Node.js 22 and pnpm 9.12.0** — matching CI. No other runtime is supported by the repo's build.
- **A Meta developer account** — a personal Facebook account with two-factor authentication on, registered at developers.facebook.com. Registration itself is free and instant (minutes, once email/phone are confirmed).
- **A Meta Business Portfolio (Business Manager)** — admin access to it. Creating the portfolio is free and instant; *verifying* it is a separate step below, and is not needed for your own test catalog.
- **A Meta app inside that portfolio — `muse shop index`** — created in the Meta app dashboard, left in **Development Mode**, with the **Catalog API** use case added. In Development Mode only people with a role on the app can use it, and only against assets your own Business Portfolio owns.
- **A Commerce Manager catalog + a System User** — a catalog owned by your Business Portfolio, and a System User assigned to that catalog, whose token goes straight into Render. The code client is read-only by construction (GET only, never a write endpoint), even though Meta's `catalog_management` scope is broader than read-only.
- **A Render account** — free to create. A payment card is required before Render will create a paid Postgres database; Render shows a $1 temporary authorization (a hold, not a charge) at that step.
- **Render Postgres `muse-shopping-index-db`** — PostgreSQL 18, Oregon, Basic $6/mo + 15GB storage $4.50/mo = **$10.50/mo**. Its `DATABASE_URL` is set on the web service `muse-shopping-index-api` by linking the database (or by adding the Internal Database URL as an environment variable and pressing Save Changes, which redeploys the service).
- **Shopify Partner account (only for a Shopify tenant such as THEENRG.COM)** — free to create. A development store and a single-store custom app with `read_products` only, token straight to Render, is the test path. A Partner account alone proves no live store, app, token, or Shop Pay partnership.
- **Stripe account (test mode only to start)** — test credentials and webhooks first; live money needs explicit approval of that exact transaction, and is never part of a demo run.
- **Meta Model API key (only for live model interpretation)** — created in the Meta developer console. Credits and availability vary by account and are not guaranteed; do not assume a credit amount.

### Every verification process, and how long Meta says it takes

Timeframes vary by account, documents, and completeness — treat every number below as Meta's claimed range, not a promise. A rejection, a mismatched name/address, or an incomplete submission restarts or extends the clock.

- **Meta developer account + app creation — minutes, instant.** Register, confirm email/phone, create the app. No Meta review at this stage.
- **Own test catalog in Development Mode, standard access — no verification, minutes once the catalog and System User exist.** This is the correct path for a submission demo with your own assets. No Business Verification and no App Review are needed for this step alone.
- **Business Verification (needed for platform/live use, other sellers' catalogs, and advanced access) — Meta's developer docs say most are processed within 48 hours, though some take longer; Meta help guides commonly cite 1–5 business days, and up to 14 business days for incomplete or mismatched submissions.** You need an exact legal name and address, an official valid document (business registration, licence, or tax certificate), and phone/email/domain verification by code (minutes for the code itself). Do not submit twice while one is pending.
- **App Review for advanced `catalog_management` and for Live mode for non-app-role users — days to weeks, varies by permission and completeness.** Third-party guides commonly cite 5–10 business days typical, 10–20 days, and 2–4 weeks when Meta asks for clarification. Meta does not publish one fixed timeframe. Before submitting you need completed app settings, at least one successful API call within 30 days before submission, a per-permission description, and a screencast showing read-only use. A rejection restarts the timer.
- **Domain, phone, and email verification (inside Business Verification) — minutes.** A code is sent and entered; the wait is in the document review, not the code.
- **Reels distribution and a signed Reel callback — a separate Meta approval, no timeframe claimed here.** Business Verification and App Review do **not** by themselves grant Reels distribution, a signed callback, or a native Muse window.
- **Shop Pay partnership, Shop backend, and Shop identity — separate approvals, no timeframe claimed here.** A store's Shop installment offer on its own site is not a partnership for Muse Shopping Index.
- **Render card check — instant.** $1 temporary authorization only; no card is charged by creating the account.
- **Render Postgres provisioning — minutes.** In this project's run the database went from Creating to Available within about 10 minutes. The web service redeploys after Save Changes; on the Free plan it also spins down after inactivity, with a 50s+ delay on the next request.
- **GitHub Pages build — minutes.** Pages rebuilds from main after a push; allow a few minutes (plus browser cache) before judging whether a new demo version is live.

### Secrets rule for every step above

Tokens, app secrets, System User tokens, and database URLs go into Render's Environment (or a secret manager) only, as values. This repo and chat carry **names only** (`DATABASE_URL`, `META_CATALOG_ACCESS_TOKEN`, `META_CATALOG_ID`, `META_MODEL_API_KEY`). Never paste a value in chat, a screenshot, or the repo, and never share one System User token across companies — platform/live use is per-seller OAuth, never one token for all tenants.

## Start

```
git clone https://github.com/DenzelR12/Muse-Shopping-Index.git
cd Muse-Shopping-Index
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm demo
```

Open `http://localhost:3100` (`PORT` or `DEMO_PORT` overrides the default). Use Node.js 22 and pnpm 9.12.0, matching CI. The demo runs without provider credentials; label demo and synthetic results accordingly.

Live model interpretation needs `META_MODEL_API_KEY`, `META_MODEL_API_BASE_URL`, and `META_MUSE_MODEL` — see [development setup](docs/technical/development.md). Do not start from this block expecting a live API; a live start needs Postgres and environment configuration, stated separately under [What is NOT live yet](#what-is-not-live-yet).

## Start Muse

First run, in the demo:

1. Reel intent resolves authorized offerings, then collects any missing details in one batch — size, quantity, dates, guests, or delivery choice — not a drip of questions.
2. Read one exact review: seller, offering and exact configuration, quantity, ship-to or pickup/service location, shipping and other fees, tax, total and currency, payment timing, and refund/cancellation terms. Payment labels are **Saved payment** and **Shop Pay · Saved payment** only — never a raw provider account or variant identifier.
3. Approve once, for those exact terms. The approval button is labelled with the amount; it disables on click and a second in-flight click is ignored.
4. If you leave, return to the same owned draft: a resume prompt revalidates first. Unexpired and unchanged returns to the review; expired or changed gets a new review, a diff in words, and fresh approval; approved or executing shows its execution state — never a fresh Buy.
5. A reminder is an explicit "Remind me" choice at review stage, default OFF. One generic reminder only, through an authorized channel only.

The exact review is rendered by the Muse feature panel (`apps/demo/src/muse-feature-panel.ts`), a host-mounted DOM panel for a Muse window/surface — not a storefront, shop site, cart page, or checkout page. The panel renders server state and dispatches host callbacks only; it never grants approval, signs a draft, or executes.

## Architecture

```
Reel (Meta) ──► Muse window ──► Exact review ──► One approval ──► Server execution ──► Verified status
                     ▲                │                    │ (consume-once)
                     │                │                    ▼
              Panel (Muse host)   Signed draft        Revalidate live state
                     │                │                    │ uncertain → reconcile,
                     └──── Index ─────┘                    │ never blind retry
                           ▲
              Meta catalog (read-only) • Shopify Storefront (read-only)
              Tenant-scoped: one seller's data never leaks to another seller.
```

## API surface — what exists, and its real status

| Route / module | Status |
|---|---|
| POST/GET/DELETE `/v1/muse/generic-profiles` | In code, Postgres + memory, company = authenticated principal |
| POST `/v1/muse/panel/approve`, `/resume`, `/reminder-opt-in`, `/reminder-opt-out` | In code, **fail-closed only** — refuses every request until panel sessions, draft lookup, and host methods are wired |
| Panel live wiring (`muse-panel-live-wiring.ts`) | Draft registry + session issuance + live host adapter, CI-gated — **live panel traffic still blocked at production host binding only** (see [panel live wiring](docs/platform/muse-panel-live-wiring.md)) |
| Exactly-once guard (`muse-exactly-once.ts`) | Atomic claim per tenant + key, replay returns original result, stale reconciles never auto-retries, burst limiter fails closed — in code, tested 8/8 locally; **no 10,000-request load test yet, no scaled host/queue** (see [exactly-once](docs/platform/muse-exactly-once.md)) |
| Meta catalog client (`meta-catalog.ts`) | Read-only, GET only, tenant-gated, TEST-labelled — **first live read verified 2026-10-28 via Graph Explorer** (see [live proof](docs/meta/live-meta-catalog-proof.md)); not yet a read through this client or a Render route |
| Shopify Storefront client | Product query only, tenant-gated, TEST-labelled — no live read yet |
| BI (`muse-bi.ts`) | Tenant-trimmed, verified-only, watermark on verified success only — supplied/demo events until a live source is credential-gated |
| Render API `muse-shopping-index-api` | Deployed, Postgres configured, root auth-gated (`unauthorized`, 2026-10-28) — no live seller/payment/panel traffic yet |

## Structure

- `apps/api/` — authentication, enrollment, approvals, provider control, Muse continuation, and transaction persistence; Meta and Shopify catalog clients, panel host wiring, the reminder, and abandoned-chat recovery.
- `apps/demo/` — competition demo, Reel intent, model policy, step machine (including the consumer-locale fail-closed gate), entry simulator, and the Muse feature panel — the product surface for the exact review, approval, resume, and reminder flows.
- `apps/business/` — business presentation modules for companies and providers.
- `apps/storefront/` — LEGACY — NOT THE PRODUCT SURFACE. Legacy demo code from the source copy, kept with its tests, not the documented presentation path for any Muse feature flow.
- `services/mcp-gateway/` — company connectors, zero-trust runtime, provider adapters, OAuth, credential vault, and audit.
- `services/` (other) — payments, bundle orchestration, fulfillment, gift intelligence, group gifting, link authority, operations, Shopify adapter and webhooks, signal shield, and telemetry store.
- `packages/` — shopping index, commerce network, domain schemas, gift graph, policy, audit, telemetry, and zero-trust primitives.
- `training/muse-commerce/` — synthetic curriculum: scenario JSON source files and generated JSONL exports (48 teaching, 30 held-out). Preparation only — no model has been trained.
- `docs/` — the specialist docs, linked not duplicated here: [technical workflow index](docs/technical/README.md), [indie submission brief](docs/submission/indie-submission-brief.md), [Muse/Meta entry contract](docs/platform/muse-entry-contract.md), [Meta catalog client](docs/meta/meta-catalog-client.md), [Shopify catalog client](docs/sellers/shopify-catalog.md), [panel host wiring](docs/platform/panel-host-wiring.md), [locale implementation](docs/research/locale-implementation-2026-10-27.md), [accessibility and abandoned-chat recovery](docs/research/accessibility-abandoned-recovery.md), [model training](docs/research/muse-model-training.md), [live model reel-watch](docs/meta/meta-model-reel-watch.md), [live readiness](docs/operations/live-readiness.md), and [Render deployment](docs/operations/render-deployment.md).
- `infra/`, `scripts/`, `tests/` — infrastructure, operational tooling, and cross-module validation.

See [SECURITY.md](SECURITY.md) for security guidance. This repository does not currently declare an open-source license; access to the source does not itself grant a license.

## Accessibility

This project is built to be usable with a keyboard, a screen reader, and low vision, not just with a mouse and full sight. In the demo and in the Muse feature panel:

- **Keyboard only:** every button and tab can be reached with Tab, and activated with Enter or Space. Focus is always visible with a clear outline, and moving to a new view moves focus to that view's heading so a screen reader does not get lost.
- **Screen readers:** buttons and tabs carry labels and pressed states, product thumbnails carry alt text, dashboard numbers are labelled as numbers (not just pictures), and price changes are announced with an aria-live region instead of silently changing on screen.
- **Seeing the text:** a text-size control and a high-contrast mode in the demo, plus a "Skip to Reels" link at the top so keyboard users do not have to tab through the whole header first.
- **Motion:** the demo respects `prefers-reduced-motion` — animations and transitions are turned off for people who ask their device for less motion.
- **Hearing and understanding:** each Reel has a short written transcript describing what is in the video, so the demo does not depend on hearing audio or seeing the video alone. The README itself follows the same rules: short sentences in the plain-English section, real headings in order, lists instead of long paragraphs, descriptive link text (never "click here"), and no meaning carried by colour alone.
- **Language:** the consumer review language rule is explicit profile language first, device/Muse locale second, location only as a fallback for locale, currency, tax, and shipping — never language guessed from location alone. If a review cannot be shown in a verified language, it fails closed instead of showing a guessed translation.

If you find a part of the demo or README that cannot be used with a keyboard, a screen reader, or large text, that is a bug in this project, not a limitation of the reader.

## Commands

```
pnpm demo            # run the competition demo (localhost:3100 by default)
pnpm typecheck       # typecheck the workspace
pnpm build           # build the workspace
pnpm test            # run the workspace test suite
node scripts/build-muse-commerce-training.mjs --check   # verify training exports match scenarios
node scripts/rehearse-muse.mjs   # offline no-money rehearsal (blocks network fetch, clears credentials in child)
node scripts/hackathon-preflight.mjs   # configuration checks
```

Keep `MUSE_AGENT_ENABLED=false` until controlled test-environment validation is complete. Never use live money without explicit approval of that exact transaction. The full required suite is defined in [CI](.github/workflows/ci.yml).

## What is NOT live yet

- **10,000-request burst handling is not proven.** The exactly-once guard is in code, but no concurrent load test, queue service, or scaled host exists yet — a burst is fail-closed, not guaranteed through.
- No live seller, no live payment, no live Shop handling, and no live Shopify catalog read. First live Meta catalog read verified 2026-10-28 via Graph Explorer only (see [live proof](docs/meta/live-meta-catalog-proof.md)); not yet through the repo client or a Render route.
- No native Muse window. The panel is host-agnostic DOM a Muse host mounts; native Muse integration needs Meta approval and is not claimed.
- No live panel-to-API routes yet. Panel host wiring maps callbacks to existing server methods; a production host passing bound methods is still a separate step.
- No live reminder channel. Opt-in entry and wiring exist, but no authorized channel is configured, so no live reminder is claimed.
- No live seller, payment, or panel traffic yet. The Render service now has Postgres (`muse-shopping-index-db`, PostgreSQL 18, Oregon) and `DATABASE_URL` set (verified 2026-10-28); its root now returns `unauthorized` for an unauthenticated request, not `persistent_rate_limit_not_configured`. That is an auth-gated server with a database configured, not a live transaction. See [live readiness](docs/operations/live-readiness.md) and [Render deployment](docs/operations/render-deployment.md).
- Training is synthetic preparation only: 48 teaching and 30 held-out scenarios, no weight update. One live model result exists: the [reel-watch run](docs/meta/meta-model-reel-watch.md) (2026-10-29, muse-spark-1.3, 3 reel frames → UNCERTAIN with both candidates on an ambiguous reel, 4011 tokens).
- Green CI does not establish external credentials, webhook delivery, live transaction success, native connector approval, receipt delivery, or Shop-app visibility.
