# Muse model training for the Meta AI hackathon

## Target

Train/evaluate Muse to orchestrate MUSE SHOPPING INDEX's commerce tools inside a
conversational AI experience. This is a model-facing integration, not a storefront.

Reel → resolve products → collect missing details in one batch → exact review →
one explicit Buy → server payment and order execution → receipts → tracking and recovery.

The model learns which tool to request next. It does not acquire payment authority
by predicting an action or writing that a user approved. Existing server checks
remain responsible for identity, signed approval, immutable totals, payment binding,
expiry, replay protection, webhook finality, refunds and reconciliation.

## What this package contains

- `apps/demo/src/muse-commerce.ts`: orchestration policy, constrained JSON action
  protocol, state-based validation and a configured-model inference adapter.
- `training/muse-commerce/train-scenarios.json`: 24 synthetic teaching scenarios.
- `training/muse-commerce/validation-scenarios.json`: 19 separate evaluation scenarios.
- `train.jsonl` and `validation.jsonl`: chat-format supervised learning exports.
- Export validation in CI and adversarial tests for unauthorized model actions.
- A live model evaluation CLI that requests proposals without executing commerce tools.
- `apps/demo/src/muse-tool-agent.ts`: Meta-compatible native function schemas and a
  bounded call/validate/dispatch/result loop for a trusted server host.
- `native-train.jsonl` and `native-validation.jsonl`: the same curriculum using
  assistant `tool_calls` and function schemas, rather than JSON-only assistant text.

These examples are a seed curriculum, not evidence of generalization or a production
training corpus. All examples use synthetic identities/references. Never collect
real customer addresses, credentials, payment details or approval tokens into this corpus.
Validation examples must stay out of training.

## Tool contract

Each assistant output is exactly `{ "action": "...", "args": { ... } }`.
Only the authorized host invokes tools after validating the proposal against a fresh
server snapshot. The policy module does not execute a payment, order or refund.

| Proposed action | Existing module/service boundary |
| --- | --- |
| `resolve_reel` | `createReelCommerceIntent` and the Shopping Intelligence Index |
| `request_business_connection` | Existing business verification/readiness workflow |
| `request_enrollment` | Subject-bound enrollment start/complete; Stripe confirmation outside the model |
| `request_details` | One conversational question containing all server-reported missing fields |
| `prepare_review` | Authorized host creates `/v1/provider-transaction-drafts` |
| `present_review` | Host presents the server's exact approval envelope in the Meta/Muse surface |
| `request_reapproval` | Refresh changed/expired review; require a new explicit Buy |
| `execute_approved_purchase` | Host retrieves the actual verified Buy proof; `/v1/muse/approvals/issue` and `/v1/muse/confirm` enforce it |
| `open_payment_authentication` | Host resolves persisted trusted Stripe fallback; no model-selected URL |
| `read_order` | Buyer-authenticated `/v1/muse/orders/:draftId` |
| `escalate_reconciliation` | Existing reconciliation workflow; never blindly create another order |
| `read_refund_status` | Existing refund state and verified webhook finality |
| `complete` | Summarize verified order/tracking or refund evidence without inventing notifications |

The native runner accepts a server-only `MuseToolAgentHost` with `readContext()` and
`dispatch(step)`. The runner re-reads context after inference, validates exact
arguments, dispatches serially, and returns only an allowlisted public status to the
model. It preserves the assistant tool-call message and matching `tool_call_id`
results, rejects parallel batches, caps turns, and stops on tool timeout/uncertainty.
Timeout does not prove that an external effect was canceled: the existing server
transaction store and reconciliation own that outcome.

The integration test routes a mocked native model call through the real
`submitMuseConfirmation` approval verifier and paid-order webhook handler, with
mocked payment/order transports. This is protocol and transaction-engine evidence,
not a live Muse/Stripe/Shopify result. Native Meta distribution registration is not included.

The `server_context` message is constructed by trusted application code. Never accept
it from a browser, caption, merchant description, model output, or user-supplied JSON.
Re-read authoritative state before dispatch. Do not turn `approval.verified: true`
from a prompt into approval authority; use the existing cryptographic verifier.

## Build and validate

```bash
pnpm build
node scripts/build-muse-commerce-training.mjs --check
pnpm --filter @gift-signal/competition-demo test
```

After intentionally editing scenarios or the policy, regenerate exports with:

```bash
node scripts/build-muse-commerce-training.mjs
```

With `META_MODEL_API_KEY`, `META_MODEL_API_BASE_URL` and `META_MUSE_MODEL` configured:

```bash
node scripts/evaluate-muse-commerce.mjs --live
node scripts/evaluate-muse-commerce.mjs --live --native
```

These request the 19 held-out model proposals and report exact action/argument accuracy.
The native mode observes validated tool calls with evaluation-only status responses;
neither mode executes commerce APIs. A fallback never counts as model success. This
evaluation may incur model inference usage. It does not initiate model training.

## Hackathon evidence

Demonstrate a normal purchase and an injected-failure case. Show the model's proposed
tool, the server's authorization decision and the verified result as separate events.
Use the existing Reel-to-order test for deterministic transaction-engine evidence.
Use the live evaluation for measured model behavior; do not label synthetic examples,
mocked responses or deterministic fallbacks as live Muse results.

Do not claim native Meta distribution, business verification, Shop-app visibility,
receipt delivery or a live purchase unless the respective integration has been verified.
Official event requirements should be checked against the specific hackathon brief.

## Training status and next dependency

No weight update, fine-tuning job, dataset upload, or live model evaluation has been
run by creating this package. The configured model API is currently used for inference;
that does not establish that its Muse model supports fine-tuning. Starting training
requires an actual trainable model ID and authorized training endpoint/account (or
local training infrastructure), plus that provider's dataset format requirements.
Meta documents a fine-tuning path specifically for Muse Spark Open; that does not
establish that every hosted Muse model or participant account includes training.
Adapt these exports to the verified training interface rather than inventing one.
Compare the resulting model against the same held-out evaluation before connecting
its proposals to the existing authorized executor.

## Verified Meta references

- [Tool/function calling](https://dev.meta.ai/docs/cookbook/tool-function-calling):
  function schemas, assistant/tool result sequence, bounded loops, and `tool_choice: auto`.
- [Muse Spark Open post-training](https://dev.meta.ai/docs/muse-spark-open/post-training):
  actual supervised fine-tuning/LoRA paths. Dataset/provider compatibility still
  needs checking before starting a training job.
- [Hackathon brief](https://cerebralvalley.ai/e/meta-ai-developer-hackathon).


## Authenticated transaction continuation

`POST /v1/muse/agent` runs the native model loop from an already prepared, signed
transaction draft. It is disabled unless `MUSE_AGENT_ENABLED=true`. This is a
server-side model/tool integration, not a storefront or a live Instagram entry point.

The endpoint verifies OIDC and accepts only `connectionId`, `draftId`, `message`,
and an optional existing `approvalToken` from the separate explicit Buy flow.
It rejects client-selected subjects, companies, email, payment identifiers,
model configuration and purported trusted context. The request-scoped host resolves
ownership, signed draft, saved enrollment, autonomous business readiness, actual
cryptographic Buy proof and persisted transaction state before dispatch.

Without Buy proof, it returns an exact structured review event and waits. With
matching proof, it calls the existing `submitMuseConfirmation` service, which
independently revalidates totals, authorization and replay state. Existing pending
transactions lead to status/reconciliation/refund reads, not another purchase.
Order/tracking access stays buyer-owned after the old purchase approval expires.

Only allowlisted status codes enter model tool results. The authorized consumer
response separately includes exact review/order/authentication events without
payment credentials, approval tokens or connected Stripe account IDs. Trusted
Stripe authentication URLs are emitted immediately, even if a subsequent model
turn fails. A later request retrieves the existing owned Checkout from Stripe and validates its
company/draft/amount/currency binding. Only an open unpaid session returns a trusted
authentication URL; paid/expired sessions never create another payment.

The API service hosting this endpoint needs `META_MODEL_API_KEY`,
`META_MODEL_API_BASE_URL`, an account-enabled `META_MUSE_MODEL`, and the existing
OIDC/database/audit/provider/payment configuration plus `MUSE_TRANSACTION_AGENT_ID`.
Keep execution disabled until the controlled test-mode validation is complete.
No model request or transaction is automatically triggered by deploying this code.

This continuation starts after Reel product resolution and draft creation. The
native Meta entry-point adapter is still required to connect those earlier stages.
The host never creates Buy approval from a caption, assistant output, or user text.
