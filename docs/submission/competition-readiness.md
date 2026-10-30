# Competition readiness

MUSE SHOPPING INDEX is a universal company-to-agent connectivity layer. Shopify and
Stripe are reference adapters; other companies use their own authorized APIs and
capabilities. See [company adapter contract](../platform/company-adapter-contract.md).

## Verified by repository checks

- Company manifests, scoped grants, adapter registry and zero-trust execution runtime.
- Shopping index across products, travel, tickets, services, reservations and digital offers.
- Exact signed review/Buy binding, expiry, replay protection and subject-bound enrollment.
- Native model tool schemas, a bounded loop and an authenticated transaction host.
- Reference payment/order orchestration, owned status/tracking, refund and reconciliation tests.
- Synthetic model curriculum and held-out evaluation tooling.
- A credential-cleared, network-guarded no-money rehearsal command.

These checks use mocked model/provider transports unless a test explicitly states
otherwise. They do not prove live model accuracy, native Meta onboarding, real
transaction completion or public-launch readiness.

## Configuration and integration still required

- Actual Meta model access and measured live tool-calling results.
- Database connection, OIDC/Shop identity and authorized company/provider credentials.
- Native Meta connector/Reels entry, account linking and trusted confirmation integration.
- Company-specific policies, supported capabilities and reviewer test accounts.
- Controlled provider-sandbox transaction, webhook delivery and recovery evidence.
- Shop app visibility where the selected merchant uses Shopify/Shop; other companies
  use their own confirmation/status systems.
- Platform review acceptance and production operations evidence.

## Executable preparation

```bash
pnpm build
node scripts/rehearse-muse.mjs
node scripts/hackathon-preflight.mjs
node scripts/hackathon-preflight.mjs --probe-model
```

The last command needs real model configuration and may consume model credits;
it does not execute commerce tools. See the [launch runbook](hackathon-launch-runbook.md)
for provider-specific test-mode gates and the exact evidence sequence.

A green build is preparation evidence, not a claim that all remaining integrations
are complete. Never describe a pending checkout as a confirmed transaction or
illustrative interaction counts as measured conversion results.
