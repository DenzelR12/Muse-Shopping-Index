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

## Documentation — start here, follow the workflow

Start with the [technical documentation index](docs/technical/README.md). It is organized as a readable workflow, in the order a reader should follow it:

1. Shop this reel / intent → [System architecture](docs/technical/system-architecture.md)
2. Resolve authorized offerings → [Company adapter contract](docs/company-adapter-contract.md)
3. Prepare a signed draft → [Transaction lifecycle](docs/technical/transaction-lifecycle.md)
4. Present the exact review → [Transaction lifecycle](docs/technical/transaction-lifecycle.md)
5. Explicit human approval → [Transaction lifecycle](docs/technical/transaction-lifecycle.md) and [Security and data](docs/technical/security-and-data.md)
6. Server execution → [API and tool reference](docs/technical/api-reference.md)
7. Verified owned status, tracking, refunds, reconciliation → [Transaction lifecycle](docs/technical/transaction-lifecycle.md)
8. Run and operate it → [Development and validation](docs/technical/development.md) and [Operations](docs/technical/operations.md)

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
| Training preparation | Synthetic teaching and held-out evaluation sets, JSONL exports and evaluation scripts exist. Export generation is not model training; no weight update or live model result is established by the repository. |
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

The offline rehearsal blocks default network fetch and clears transaction/model credentials in its child process. PostgreSQL integration runs separately in CI; an offline skip is not a passing database test. The full required suite is defined in [CI](.github/workflows/ci.yml) — pending: the workflow file currently in this repo is at the repo root as `GitHub workflow ci.yml.txt` and must be moved/renamed to exactly `.github/workflows/ci.yml`; GitHub Actions will not run it from the root, and Muse cannot push workflow files (no Workflows permission).

For configuration checks, use `node scripts/hackathon-preflight.mjs`. Keep `MUSE_AGENT_ENABLED=false` until controlled test-environment validation is complete. Never use live money without explicit transaction approval.

## Repository map

- `apps/api`: authentication, enrollment, approvals, provider control, Muse continuation and transaction persistence.
- `apps/demo`: competition demonstration, Reel intent, model policy, native tools and inference adapters.
- `apps/business` and `apps/storefront`: business and consumer presentation modules.
- `services/mcp-gateway`: company connectors, zero-trust runtime, provider adapters, OAuth, credential vault and audit.
- `services/payments`: payment contracts and reference implementation.
- Other `services/`: recommendations, bundles, policy, fulfillment, gifting, links, telemetry and operations.
- `packages/`: shopping index, commerce network, domain schemas, gift graph, policy, audit, telemetry and zero-trust primitives.
- `training/muse-commerce`: synthetic curriculum and generated exports.
- `infra`, `scripts`, `tests`: infrastructure, operational tooling and cross-module validation.

See [SECURITY.md](SECURITY.md) for security guidance. This repository does not currently declare an open-source license; access to the source does not itself grant a license.
