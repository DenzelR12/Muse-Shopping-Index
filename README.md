# Muse Shopping Index

Tap **Shop this reel** in Muse, review exactly once, approve once, and let the server execute — fewer clicks from a Reel to the door.

`muse shop index` is the Meta app inside this project — not a separate product, and not a new name for the project.

- **Reel → Muse window → exact review → one explicit approval → server execution.** Shop handles the post-approval backend where authorized: notifications, verification, email, and shipping updates.
- **Approval is consume-once and bound to exact terms.** A changed price, tax, shipping, configuration, terms, or payment authorization needs fresh approval (reapproval). Uncertain completion goes to reconciliation, never a blind retry or a second charge.
- **Resume by draft, plus one generic opt-in reminder.** Return to an existing owned draft, revalidated first; expired or changed drafts get a new review, a diff, and fresh approval. A reminder is explicit opt-in only, generic, one only, with no price, seller, or pitch.
- **Read-only catalog reads, TEST-labelled.** Meta and Shopify catalog clients are gated, tenant-scoped, and strip raw provider IDs; a read consumes no approval.
- **The model proposes; the deterministic server authorizes.** Model, caption, or browser text never grants approval, signs a draft, or supplies seller facts. Company and consumer data stay tenant-scoped to their authenticated identity.

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

## Structure

- `apps/api/` — authentication, enrollment, approvals, provider control, Muse continuation, and transaction persistence; Meta and Shopify catalog clients, panel host wiring, the reminder, and abandoned-chat recovery.
- `apps/demo/` — competition demo, Reel intent, model policy, step machine (including the consumer-locale fail-closed gate), entry simulator, and the Muse feature panel — the product surface for the exact review, approval, resume, and reminder flows.
- `apps/business/` — business presentation modules for companies and providers.
- `apps/storefront/` — LEGACY — NOT THE PRODUCT SURFACE. Legacy demo code from the source copy, kept with its tests, not the documented presentation path for any Muse feature flow.
- `services/mcp-gateway/` — company connectors, zero-trust runtime, provider adapters, OAuth, credential vault, and audit.
- `services/` (other) — payments, bundle orchestration, fulfillment, gift intelligence, group gifting, link authority, operations, Shopify adapter and webhooks, signal shield, and telemetry store.
- `packages/` — shopping index, commerce network, domain schemas, gift graph, policy, audit, telemetry, and zero-trust primitives.
- `training/muse-commerce/` — synthetic curriculum: scenario JSON source files and generated JSONL exports (48 teaching, 30 held-out). Preparation only — no model has been trained.
- `docs/` — the specialist docs, linked not duplicated here: [technical workflow index](docs/technical/README.md), [indie submission brief](docs/indie-submission-brief.md), [Muse/Meta entry contract](docs/muse-entry-contract.md), [Meta catalog client](docs/meta-catalog-client.md), [Shopify catalog client](docs/shopify-catalog.md), [panel host wiring](docs/panel-host-wiring.md), [locale implementation](docs/locale-implementation-2026-10-27.md), [accessibility and abandoned-chat recovery](docs/accessibility-abandoned-recovery.md), [model training](docs/muse-model-training.md), [live readiness](docs/live-readiness.md), and [Render deployment](docs/render-deployment.md).
- `infra/`, `scripts/`, `tests/` — infrastructure, operational tooling, and cross-module validation.

See [SECURITY.md](SECURITY.md) for security guidance. This repository does not currently declare an open-source license; access to the source does not itself grant a license.

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

- No live seller, no live payment, no live Shop handling, and no live Meta or Shopify catalog read.
- No native Muse window. The panel is host-agnostic DOM a Muse host mounts; native Muse integration needs Meta approval and is not claimed.
- No live panel-to-API routes yet. Panel host wiring maps callbacks to existing server methods; a production host passing bound methods is still a separate step.
- No live reminder channel. Opt-in entry and wiring exist, but no authorized channel is configured, so no live reminder is claimed.
- No live hosted API yet. The Render service still has no Postgres and no `DATABASE_URL`; its root still returns `persistent_rate_limit_not_configured`. See [live readiness](docs/live-readiness.md) and [Render deployment](docs/render-deployment.md).
- Training is synthetic preparation only: 48 teaching and 30 held-out scenarios, no weight update, no live model result established by the repository.
- Green CI does not establish external credentials, webhook delivery, live transaction success, native connector approval, receipt delivery, or Shop-app visibility.
