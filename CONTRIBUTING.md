# Contributing to Muse Shopping Index

Thanks for your interest. Muse Shopping Index is the verification and seller
layer for shopping in Muse: tap "Shop this reel," Muse Spark verifies the
exact item live, the consumer reviews once and approves once, and the server
executes. Contributions are welcome — this guide is the short version of how
the project works and the rules that keep it safe.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first. Security issues
do **not** go in public issues — follow [SECURITY.md](SECURITY.md) instead.

## Setup

Requirements: Node.js 22 and pnpm 9.12.0 (the `packageManager` field in
`package.json` pins the pnpm version).

```bash
pnpm install
cp .env.example .env   # names only — real values belong in a secret manager
pnpm demo              # run the competition demo (localhost:3100 by default)
```

The demo runs without provider credentials. Anything it shows without live
credentials is demo or TEST data and must stay labelled that way.

## Commands

```bash
pnpm demo            # run the competition demo (localhost:3100 by default)
pnpm typecheck       # typecheck the workspace
pnpm build           # build the workspace
pnpm test            # run the workspace test suite
node scripts/build-muse-commerce-training.mjs --check   # verify training exports match scenarios
node scripts/rehearse-muse.mjs   # offline no-money rehearsal (blocks network fetch, clears credentials in child)
node scripts/hackathon-preflight.mjs   # configuration checks
```

The full required suite is defined in [CI](.github/workflows/ci.yml), and CI
must pass on the exact head of your change.

## Ground rules (these are load-bearing, not style)

- **This is a Muse feature, not a storefront.** The review/resume panel is
  mounted by a Muse host inside a Muse window or surface. Never frame the
  product as a storefront, shop site, cart page, or checkout page.
- **Never rename `GIFT_SIGNAL_API_KEYS` or the `gift-signal` identifiers.**
  Stripe idempotency prefixes depend on them; renaming can double-charge.
- **No secrets in the repo, ever.** No passwords, API keys, approval tokens,
  card numbers, or webhook secrets in code, docs, issues, or commits.
  Credentials go through a secret manager or the deployment environment only.
- **Do not weaken the safety properties.** Exact approval is signed and
  single-use (consume-once); drift or expiry forces a fresh review and a new
  approval; uncertain execution reconciles instead of risking a double charge;
  raw IDs fail closed; reporting is tenant-scoped. A model, a caption, a demo
  bridge, or a browser field never grants approval, signs a draft, or supplies
  seller facts.
- **Honesty about what is live.** Demo, supplied-events, and blocked paths are
  labelled as such. Never claim a live seller, payment, Shop, or Meta
  capability without verified live evidence. TEST data is labelled TEST.
- **Never use live money** without explicit approval of that exact
  transaction, and keep `MUSE_AGENT_ENABLED=false` until controlled
  test-environment validation is complete.

## Making a change

1. Branch off `main` with a descriptive name.
2. Keep the change scoped; update docs when behavior or claims change.
3. Add or update tests for behavior changes — cover failure and forgery
   paths, not only success paths.
4. Run `pnpm typecheck`, `pnpm build`, and `pnpm test` locally.
5. Open a pull request and complete the pull request template (change type,
   security boundary, deployment). CI must be green on the exact head before
   merge.

## Reporting bugs and suggesting features

Use the issue templates. For bugs, include the steps to reproduce and your
device/browser — the demo is tested on iPhone, tablet, and laptop, and layout
problems are device-specific more often than not. Accessibility barriers are
bugs in this project: see [ACCESSIBILITY.md](ACCESSIBILITY.md).
