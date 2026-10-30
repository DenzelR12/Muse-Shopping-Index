# Development, testing and contribution

## Prerequisites

Use Node.js 22, pnpm 9.12.0 and Git. Docker Compose is optional for local PostgreSQL/Redis. CI uses PostgreSQL 16; local Compose currently uses PostgreSQL 17 Alpine. Validate behavior against the intended deployment version rather than assuming all versions are identical.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm demo
```

The demo listens on port 3100 by default. `pnpm demo` runs the competition-demo development entry point. Credential-free behavior is synthetic/demo evidence; configure actual model access only when making deliberate live inference calls.

## Local API and database

```bash
cp .env.example .env

docker compose up -d postgres redis
```

Edit the local `.env` outside version control. The example's default PostgreSQL URL does **not** match Compose's database user/password. For this local Compose file only, set:

```dotenv
DATABASE_URL=postgresql://gift_signal:local_only_change_me@localhost:5432/gift_signal
REDIS_URL=redis://localhost:6379
MUSE_AGENT_ENABLED=false
```

Compose credentials are disposable local development values, never production credentials. Its SQL initialization runs when the PostgreSQL data volume is first created; restarting an existing volume does not reapply the init file. Runtime stores initialize additional tables as documented in [security/data](security-and-data.md).

The API does not automatically load `.env` through its plain `start` command. After building, use Node's explicit environment-file option from the repository root:

```bash
node --env-file=.env apps/api/dist/index.js
```

Alternatively inject variables through your process manager. Do not commit populated environment files. API port defaults to 3000. Local API startup alone does not establish that identity/provider transactions are configured.

## Validation layers

| Check | Command / evidence |
| --- | --- |
| Workspace types | `pnpm typecheck` |
| Workspace builds | `pnpm build` |
| Model curriculum integrity | `node scripts/build-muse-commerce-training.mjs --check` |
| No-money cross-module rehearsal | `node scripts/rehearse-muse.mjs` |
| Demo/native model unit tests | `pnpm --filter @gift-signal/competition-demo test` |
| API/module tests | Exact commands in `.github/workflows/ci.yml` |
| Real database enrollment behavior | CI enrollment test with dedicated `ENROLLMENT_TEST_DATABASE_URL` |
| Configuration audit | `node scripts/hackathon-preflight.mjs` |
| Reference-adapter audit | `node scripts/hackathon-preflight.mjs --stripe-shopify` |
| Live model behavior | `node scripts/evaluate-muse-commerce.mjs --live --native` after authorized account setup |

The rehearsal clears live credentials in its child process and blocks default fetch. Its explicit transports are mocks. The PostgreSQL case is intentionally skipped offline and runs separately in CI. Do not point `ENROLLMENT_TEST_DATABASE_URL` at a production database.

The required CI suite covers discovery/index learning, commerce network, provider adapters/OAuth/vault/runtime/pricing, generic approval and identity, zero-trust connectors, audit, business console, rate limiting, enrollment concurrency, readiness, signed drafts, native host, payments, fulfillment, refunds/recovery, observability and Reel-to-order integration. Consult the workflow for the current full list; `pnpm test` alone is not the complete required pipeline.

## Training and evaluation

The curriculum currently contains 24 synthetic training and 19 separate validation scenarios. Both JSON-action and native tool-call JSONL formats are generated. After intentional policy/scenario changes:

```bash
node scripts/build-muse-commerce-training.mjs
node scripts/build-muse-commerce-training.mjs --check
```

Keep held-out cases out of training. Measure action/argument accuracy and inspect unsafe failures separately. A successful export is not an SFT/LoRA job. Live evaluation consumes inference usage but does not run commerce APIs; do not connect evaluation tools to transaction execution. Actual training requires an authorized trainable model/infrastructure and compatible data interface. See [model guide](../research/muse-model-training.md).

## Safe integration workflow

1. Change a typed contract or adapter under the owning workspace.
2. Keep consumer/company/payment scope server-owned.
3. Add meaningful adversarial tests when changing authorization or external-effect recovery.
4. Run affected tests, types/build and required CI checks.
5. Update request/state/config documentation with the implementation.
6. Open a reviewable PR; merge only with green required checks.
7. Verify deployment separately from merge and record actual external test evidence.

Documentation-only edits require link/reference checks and review for claims that exceed the source. Avoid calling mock fixtures a live integration, illustrative interaction counts a measured metric, or configuration flags proof of readiness.

## Evidence standard

Record commit, environment, model ID when applicable, test command, transport type, result and unresolved failures. Separate four claims: code compiled; mocked modules behaved correctly; a live model proposed valid tools; authorized providers completed a controlled transaction. Each needs its own evidence.
