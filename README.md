# Muse Shopping Index

**Commerce intelligence and transaction authority for Muse and authorized company connectors.**

Muse Shopping Index lets a conversational agent discover actionable offers, prepare an exact purchase or booking, obtain explicit human approval, and coordinate execution and recovery — with fewer clicks from intent to delivery.

Muse interprets intent and selects tools. Deterministic server code owns identity, permissions, pricing evidence, approval, payment authorization, replay protection and transaction state. A model prediction never grants transaction authority.

This project is being prepared for the Meta AI developer hackathon. Its primary integration is model-facing orchestration. Consumer and business UI workspaces support the platform; a storefront is not required to use its agent tools.

## Shop this reel, fewer clicks to the door

The intended experience is:

1. A person sees a Reel and taps **Shop this reel**.
2. Muse resolves the relevant, authorized offerings.
3. Muse collects any missing details in one consolidated batch — size, quantity, dates, guests, or delivery choice — not a drip of questions.
4. Muse presents one exact review: seller, offering and exact configuration, quantity, ship-to or pickup/service location, shipping and other fees, tax, total and currency, payment timing, and refund/cancellation terms.
5. The person explicitly approves once, for those exact terms.
6. The server executes once, with duplicate protection.
7. Shop handles the backend after that point where it is the authorized channel: order notifications, verification, email, and shipping updates.
8. Muse presents verified owned status, tracking where applicable, and refund or reconciliation options where needed.

Changed price, tax, shipping, configuration, terms, or payment authorization requires fresh approval. Uncertain external completion leads to status and reconciliation, not a blind retry or a second charge.

Shop is the consumer backend story here, not a claim that every merchant is live on Shop. Each company still needs actual authorization, supported capabilities, credentials, implementation, and validation. A catalog name is not a live integration.

Fewer clicks, in plain terms: intent → one batch of details → one exact review → one approval → server execution → Shop backend notifications, verification, email, and shipping where authorized. That is the intended backend story: Shop handles the post-approval backend where the merchant is authorized on Shop, while Muse presents verified owned status and recovery. This paragraph describes the intended flow; it does not claim a live Shop integration, live payment, or live shipping for any specific merchant.

## Documentation — start here, follow the workflow

Start with the [technical documentation index](docs/technical/README.md). It is organized as a readable workflow, in the order a reader should follow it:

1. Shop this reel / intent → [System architecture](docs/technical/system-architecture.md)
2. Resolve authorized offerings → [Company adapter contract](docs/company-adapter-contract.md)
3. Collect missing details in one batch → [Transaction lifecycle](docs/technical/transaction-lifecycle.md)
4. Prepare a signed draft → [Transaction lifecycle](docs/technical/transaction-lifecycle.md)
5. Present the exact review → [Transaction lifecycle](docs/technical/transaction-lifecycle.md)
6. Explicit human approval → [Transaction lifecycle](docs/technical/transaction-lifecycle.md) and [Security and data](docs/technical/security-and-data.md)
7. Server execution → [API and tool reference](docs/technical/api-reference.md)
8. Verified owned status, tracking, refunds, reconciliation → [Transaction lifecycle](docs/technical/transaction-lifecycle.md)
9. Run and operate it → [Development and validation](docs/technical/development.md) and [Operations](docs/technical/operations.md)

Other guides:

| Guide | Contents |
| --- | --- |
| [System architecture](docs/technical/system-architecture.md) | Boundaries, workspaces, trust model and company integrations |
| [Transaction lifecycle](docs/technical/transaction-lifecycle.md) | Enrollment, exact approval, payment, orders, refunds and reconciliation |
| [API and tool reference](docs/technical/api-reference.md) | HTTP surfaces, authentication, payloads, errors and MCP tools |
| [Security and data](docs/technical/security-and-data.md) | Tenant isolation, persistence, credentials, audit and threat controls |
| [Development and validation](docs/technical/development.md) | Local setup, commands, CI and evidence standards |
| [Operations](docs/technical/operations.md) | Configuration, deployment, monitoring, recovery and launch gates |
| [Muse model integration](docs/muse-model-training.md) | Tool protocol, synthetic curriculum, native loop and evaluation |
| [Company adapter contract](docs/company-adapter-contract.md) | Requirements for integrating any authorized company |
| [Hackathon runbook](docs/hackathon-launch-runbook.md) | No-money rehearsal, model access and controlled sandbox validation |

## Current implementation

| Area | Repository evidence and limits |
| --- | --- |
| Universal company orchestration | Typed company adapters, connection grants, signed drafts, live revalidation and replay controls exist. Each company still needs an authorized implementation. |
| Muse integration | Native tool runner and authenticated signed-draft continuation exist. Native Meta/Reels entry, account linking and trusted confirmation callback remain integration work, and are labeled as such where they appear. |
| Transaction reference implementation | Subject-bound enrollment, exact saved-payment approval, direct payment, trusted authentication fallback, reference fulfillment, buyer-owned status, refunds and reconciliation are implemented and tested with mocked transports. |
| Meta catalog client | Read-only GET client for one company's own catalog (`apps/api/src/meta-catalog.ts`, [Meta catalog client](docs/meta-catalog-client.md)), gated and TEST-labelled. No live catalog read, live seller, App Review, or Business Verification is claimed. |
| Muse/Meta entry | Signed reel-entry intent only ([Muse/Meta entry contract](docs/muse-entry-contract.md)), with 410 without a signing secret and 401 on a bad HMAC; it creates nothing. The demo simulator (`apps/demo/src/muse-entry-simulator.ts`) is NOT a native Meta button, Meta distribution, or a Meta callback. |
| Training preparation | 48 teaching and 30 held-out synthetic scenarios ([Muse model training](docs/muse-model-training.md), [training update 2026-10-27](docs/training-update-2026-10-27.md), [multilingual training update 2026-10-27](docs/training-update-multilingual-2026-10-27.md)), with scenario JSON source files and generated JSONL exports and evaluation scripts. Export generation is not model training; no weight update or live model result is established by the repository. |
| Locale as code | Consumer-locale field (`consumerLocale`) and fail-closed review gate in the demo step machine (`apps/demo/src/muse-commerce.ts`, [Locale implementation](docs/locale-implementation-2026-10-27.md)): profile language preference first, device/Muse locale second, location never consulted as a language, caption language never sets the review language. If no verified review in the consumer's language is available, the step machine collects the verified version first and never presents an unverified or model-translated review, and never seeks approval or execution. Demo review rendering is still English-only in presentation, and production host wiring to supply the locale from authenticated profile/device data is not done. No live multilingual review or multilingual UI is claimed. |
| Opt-in reminder | Server component for a single generic reminder (`apps/api/src/muse-reminder.ts`, [Reminder implementation](docs/reminder-implementation-2026-10-27.md)): an explicit consumer opt-in per consumer, company, and draft only; one reminder only, with a frozen generic message and no price, title, term, token, or ID; fail-closed without a startup-registered authorized channel; opt-out/dismiss permanently prevents that draft's reminder. No live channel is configured, no consumer-facing opt-in entry in the review UI exists yet, and no live reminder is claimed. |
| Accessibility and abandoned-chat recovery | Design and training only ([Accessibility and abandoned-chat recovery](docs/accessibility-abandoned-recovery.md)): exact review as real text in screen-reader order with the approval labelled with the amount, diffs announced in words, generous expiry with a pre-expiry warning, and resume by existing owned draft with revalidation — expired or changed drafts get a new review, diff, and fresh approval. One generic opt-in reminder only, no dark patterns, and abandoned drafts are never fed into ad retargeting. No accessibility standard is claimed or audited, and no live recovery is claimed; the reminder mechanism, real-text renderer, announced status, pre-expiry warning, and production resume path remain code needed except for the reminder server component above. |
| Production readiness | Green CI does not establish external credentials, webhook delivery, live transaction success, native connector approval, receipt delivery or Shop-app visibility. |

Reference adapters are not mandatory infrastructure for every company. Other companies can retain their own catalogs, payment rails, booking systems and fulfillment APIs. The current authenticated Muse transaction host and API production readiness gate are still tied to the reference profile; replacing those dependencies requires actual adapter integration, not simply changing a configuration flag.

## Intended consumer experience

Reel or conversational intent → actionable options → one batch of missing details → exact review → one explicit Buy → server execution → verified order or booking status and recovery.

The review must disclose seller, offering, quantity/configuration, delivery or service details, shipping, tax, total, currency and applicable terms. Changed terms require fresh approval. Merchant checkout handoffs are blocked in the reference flow; trusted payment-rail authentication is the supported exception.

Consumer-facing reviews must use safe labels such as **Saved payment** and a resolved company display name — never a raw provider account identifier or a raw variant identifier.

## Quick start

Use Node.js 22 and pnpm 9.12.0, matching CI.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm demo
```

Open `http://localhost:3100`. The demonstration can run without provider credentials; label synthetic/demo results accordingly. Live model interpretation requires an account-enabled model and the `META_MODEL_API_KEY`, `META_MODEL_API_BASE_URL` and `META_MUSE_MODEL` variables. See [development setup](docs/technical/development.md) before starting the API or local database.

## Validate

```bash
pnpm typecheck
pnpm build
node scripts/build-muse-commerce-training.mjs --check
node scripts/rehearse-muse.mjs
```

The offline rehearsal blocks default network fetch and clears transaction/model credentials in its child process. PostgreSQL integration runs separately in CI; an offline skip is not a passing database test. The full required suite is defined in [CI](.github/workflows/ci.yml).

For configuration checks, use `node scripts/hackathon-preflight.mjs`. Keep `MUSE_AGENT_ENABLED=false` until controlled test-environment validation is complete. Never use live money without explicit transaction approval.

## Repository map

- `apps/api`: authentication, enrollment, approvals, provider control, Muse continuation and transaction persistence.
- `apps/demo`: competition demonstration, Reel intent, model policy, native tools and inference adapters.
- `apps/business` and `apps/storefront`: business and consumer presentation modules.
- `services/mcp-gateway`: company connectors, zero-trust runtime, provider adapters, OAuth, credential vault and audit.
- `services/payments`: payment contracts and reference implementation.
- Other `services/`: bundle orchestration, fulfillment, gift intelligence, group gifting, link authority, operations, Shopify adapter and webhooks, signal shield, and telemetry store.
- `packages/`: shopping index, commerce network, domain schemas, gift graph, policy, audit, telemetry and zero-trust primitives.
- `training/muse-commerce`: synthetic curriculum — scenario JSON source files and generated JSONL exports.
- `docs/`: technical workflow index (`docs/technical/`), Meta catalog client, Muse/Meta entry contract, training preparation, live readiness and Render deployment guides, and specialist guides.
- `infra`, `scripts`, `tests`: infrastructure, operational tooling and cross-module validation.

See [SECURITY.md](SECURITY.md) for security guidance. This repository does not currently declare an open-source license; access to the source does not itself grant a license.
