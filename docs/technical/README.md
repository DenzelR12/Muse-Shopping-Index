# Technical documentation — Muse Shopping Index

Muse Shopping Index is a company-agnostic commerce intelligence and transaction orchestration system for Muse. These documents describe the repository implementation. They do not certify the current deployment or third-party account state, and a documented capability is not proof that a named company has authorized a live integration.

## The workflow, start to finish

Read in this order. Each step links to the document that explains it.

### 1. Shop this reel / intent

A person taps **Shop this reel** in Muse, or expresses a conversational shopping intent. Muse resolves intent; it does not itself authorize a transaction.

- Read: [System architecture](system-architecture.md)
- Demo intent code: `apps/demo/src/reel-commerce.ts`
- Read: [Muse/Meta entry contract](../muse-entry-contract.md)
- Demo entry code: `apps/demo/src/muse-entry-simulator.ts` (labelled simulator)
- Limit, stated plainly: native Meta/Reels entry, account linking, and a trusted confirmation callback are integration work. A labeled demonstration harness is not native Meta distribution.

### 2. Resolve authorized offerings

Muse resolves offerings only through authorized company adapters and server-owned connections. A catalog name alone is not a live company.

- Read: [Company adapter contract](../company-adapter-contract.md), then [System architecture](system-architecture.md)
- Adapter code: `services/mcp-gateway/src/business-connectors.ts`

#### 2a. Meta catalog read — where it fits in the chain

In the full chain — Reel intent (step 1) → **catalog read (this step)**
→ collect missing details (step 3) → signed draft (step 4)
→ exact review (step 5) → approval (step 6) → execution (step 7) — a Meta catalog read is one way an authorized
offering can be resolved, for one company's own catalog only. It does
not replace the company adapter, and it does not create an offering on
its own: catalog data still has to pass the signed-draft, exact-review,
and explicit-approval steps unchanged, and no purchase is executed by
the read itself.

- Read: [Meta catalog client](../meta-catalog-client.md)
- Client code: `apps/api/src/meta-catalog.ts` (internal helper
  `readMetaCatalog`; deliberately no new public route and no public
  purchase route)
- Read-only, by construction: the transport has exactly one method,
  GET, against versioned Graph API endpoints for one catalog's details
  and its products. There is no write method and no write endpoint,
  even though Meta defines the `catalog_management` scope more broadly
  (create/read/update/delete) — this client uses only the read part.
- Fail-closed, in order, before any network call: missing token →
  `muse_catalog_not_configured`; token present but no
  startup-registered client → `muse_catalog_client_not_registered`;
  requesting company different from the authenticated principal's
  company → `provider_readiness_company_mismatch`; missing catalog ID
  → `muse_catalog_id_not_configured` (never a default catalog, never
  a catalog shared across companies). No approval is consumed by a
  failed or successful read.
- Validation on read: title, price, and currency are required and
  validated; availability/stock is validated where returned;
  price/stock older than 24 hours is unverifiable / refresh required,
  never a guessed price; consumer output carries the resolved display
  title only, with raw provider IDs stripped, and is labelled
  `META CATALOG` / `TEST — Development Mode / test catalog`.
- Limit, stated plainly: this is client code, gated and unproven
  against a real catalog. No live catalog read, no live seller, no App
  Review, and no Business Verification is claimed, and no other
  business gains platform access from it — that would need Business
  Verification + App Review + per-business OAuth, not a shared System
  User token. Environment variable names only are documented in
  [Meta catalog client](../meta-catalog-client.md); no token, catalog
  ID, app ID, or secret value appears in any doc.

### 3. Collect missing details in one batch

Size, quantity, dates, guests, seats, service options, and ship-to / pickup / venue details are collected in one consolidated batch, not as a drip of questions.

- Read: [Transaction lifecycle and invariants](transaction-lifecycle.md)

### 4. Prepare a signed draft

The server prepares an exact, signed draft: seller, offering and configuration, quantity, fees, tax, total and currency, and terms. The draft hash binds the exact terms.

- Read: [Transaction lifecycle and invariants](transaction-lifecycle.md), [HTTP API and tool reference](api-reference.md)

### 5. Present the exact review

The consumer sees one exact review before any payment. Consumer-facing labels must be safe: a resolved company display name and **Saved payment** — never a raw provider account identifier or a raw variant identifier. If a title or configuration cannot be resolved, fail closed instead of showing an internal ID.

Note: locale is now a trusted context field, not just a training scenario — the step machine carries `consumerLocale` (profile language preference first, device/Muse locale second, location never consulted as a language) and a fail-closed review gate: if no verified review in the consumer's language is available, it collects the verified version first and never presents an unverified or model-translated review. Demo review rendering is still English-only in presentation, and production host wiring is not done.

- Read: [Transaction lifecycle and invariants](transaction-lifecycle.md), [Security, identity and data](security-and-data.md)

### 6. Explicit human approval

Approval is explicit, expiring, consume-once, and bound to the exact draft, subject, company, connection, total, currency, and payment authorization reference. Changed price, tax, shipping, configuration, terms, or payment authorization requires fresh approval. Model prose is never approval.

- Read: [Transaction lifecycle and invariants](transaction-lifecycle.md), [Security, identity and data](security-and-data.md)

### 7. Server execution

Deterministic server code — not the model — authorizes and executes. Live provider state is revalidated before execution. Duplicate Buy attempts are protected by consume-once approval, draft claiming, and provider idempotency keys.

- Read: [HTTP API and tool reference](api-reference.md), [System architecture](system-architecture.md)
- Execution code: `apps/api/src/provider-transaction-execution.ts`, `services/mcp-gateway/src/business-zero-trust.ts`

### 8. Verified owned status, tracking, refunds, reconciliation

After execution, Muse presents only owned, verified status. Shop handles backend notifications, verification, email, and shipping updates where it is the authorized channel.

- Tracking states are `PENDING`, `AVAILABLE`, and `UNAVAILABLE`. A retrieved order or tracking record does not prove delivery.
- Bookings, services, digital goods, and pickup use their own completion evidence, not parcel tracking.
- Refund states distinguish required, executing, submitted, and verified refunded finality.
- Uncertain external completion moves to reconciliation, never a blind retry.

- Read: [Transaction lifecycle and invariants](transaction-lifecycle.md), [Deployment and operations](operations.md)

### 9. Run, test, and operate it

- Read: [Development, testing and contribution](development.md), [Deployment and operations](operations.md)
- Validate with: `pnpm typecheck`, `pnpm build`, `node scripts/build-muse-commerce-training.mjs --check`, `node scripts/rehearse-muse.mjs`, and the full suite in [.github/workflows/ci.yml](../../.github/workflows/ci.yml).
- Keep `MUSE_AGENT_ENABLED=false` until controlled test-environment validation is complete. Never use live money without explicit approval of that exact transaction.

## Reading paths by audience

| Audience | Recommended sequence |
| --- | --- |
| Engineers | Architecture → lifecycle → API → security/data → development |
| Muse/model integrators | Architecture → model integration → API → approval boundary → hackathon runbook |
| Company integration teams | Company adapter contract → architecture → security/data → lifecycle |
| Operators | Operations → lifecycle recovery → validation → launch runbook |
| Reviewers/judges | Root README → this workflow → offline rehearsal → measured model/sandbox evidence |

## Canonical guides

1. [System architecture](system-architecture.md)
2. [Transaction lifecycle and invariants](transaction-lifecycle.md)
3. [HTTP API and tool reference](api-reference.md)
4. [Security, identity and data](security-and-data.md)
5. [Development, testing and contribution](development.md)
6. [Deployment and operations](operations.md)

## Specialist documentation

| Topic | Reference |
| --- | --- |
| Model policy, native tools, synthetic data and evaluation | [Muse model training](../muse-model-training.md) |
| Company adapter admission | [Company adapter contract](../company-adapter-contract.md) |
| Sandbox and hackathon preparation | [Launch runbook](../hackathon-launch-runbook.md) |
| Native connector onboarding draft | [OpenAPI JSON](../muse-connector.openapi.json) |
| Normalized shopping and discovery | [Product discovery](../product-discovery.md), [semantic product contract](../semantic-product-contract.md) |
| Cross-company network | [Universal commerce network](../universal-ai-commerce-network.md), [agentic network](../universal-agentic-commerce-network.md) |
| Connector background | [Muse commerce connectors](../muse-commerce-connectors.md), [MCP gateway](../../services/mcp-gateway/README.md) |
| Meta catalog client (read-only, gated) | [Meta catalog client](../meta-catalog-client.md) |
| Muse/Meta entry contract and demo simulator | [Muse/Meta entry contract](../muse-entry-contract.md) |
| Locale as code (trusted context field, fail-closed review gate) | [Locale implementation](../locale-implementation-2026-10-27.md) |
| Opt-in reminder server component (gated, generic, one-only) | [Reminder implementation](../reminder-implementation-2026-10-27.md) |
| Accessibility and abandoned-chat recovery design | [Accessibility and abandoned-chat recovery](../accessibility-abandoned-recovery.md) |
| Multilingual locale training scenarios | [Multilingual training update](../training-update-multilingual-2026-10-27.md) |
| Intelligence and operations | [Company intelligence](../company-intelligence-reports.md), [owner absence](../owner-absence-operations.md) |
| Production planning | [Readiness](../competition-readiness.md), [production checklist](../production-checklist.md), [zero trust](../zero-trust-production.md) |
| Demo presentation | [Competition demo](../competition-demo.md), [build notes](../competition-build.md) |
| Security reporting/guidance | [SECURITY.md](../../SECURITY.md) |

Historical design and product documents may describe intended capabilities. For executable behavior, inspect the linked source, tests and configuration gates. Documentation terms such as "supports" describe a contract or implementation, not proof that a named company has authorized a live integration.

## Glossary

| Term | Meaning |
| --- | --- |
| Subject | Consumer identity from a verified OIDC token |
| Company | Tenant that owns a provider integration and agent policy |
| Connection | Server-owned consumer grant or provider account binding; the two have different schemas |
| Offer | Evidence-backed actionable product, rate, ticket, service or digital entitlement |
| Draft | Server-stored exact proposed transaction with a signed envelope |
| Approval | Expiring, consume-once human proof bound to the exact draft and transaction scope |
| Saved authorization | Verified reusable payment reference; not a client-supplied payment-method assertion |
| Adapter | Authorized translation between platform contracts and a company's actual APIs |
| Reconciliation | Evidence-based resolution of an uncertain external effect without blind retry |
| Readiness | Evaluated prerequisites; configuration presence alone does not prove operational capability |
