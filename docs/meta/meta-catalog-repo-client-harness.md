# Repo-client harness for the live Meta catalog read

**Status:** harness code only. The live read itself has NOT been run through
this harness — the live token exists only in Render env
(`META_CATALOG_ACCESS_TOKEN`) and no token-holder run has happened yet.

## What it does

`apps/api/test/muse-live-catalog-verify.ts` is a server-side
verification script — **not a route, not an endpoint**. It is never
mounted in `index.ts`.

It reads the ClutchAgent test catalog through the read-only repo
client (`apps/api/src/meta-catalog.ts`, GET-only, tenant-gated) and
checks the result against the Graph Explorer proof
(`docs/meta/live-meta-catalog-proof.md`):

- exactly 1 item (verified + unavailable + unverifiable)
- non-empty title, `priceAmount > 0`, currency matches `/^[A-Z]{3}$/`
- `source === 'META CATALOG'`, label contains `TEST`
- `validUntil − fetchedAt === 24h`
- stringified consumer result contains no `gid://`, `myshopid`, `acct_`
  (raw provider IDs stripped)

Exit codes: `0` all checks pass, `1` any check fails, `2` config
gating (missing token, missing catalog ID, invalid config).

## Running it (token holder only)

The token value is never asked for in chat, never printed, and never
stored in the repo. Only presence is reported.

```bash
META_CATALOG_ACCESS_TOKEN=<from secret manager only> \
META_CATALOG_ID=<catalog id> \
  npx tsx apps/api/test/muse-live-catalog-verify.ts
```

The read uses tenant `clutchagent` for both `companyId` and
`principalCompanyId` — never the synthetic fixture company, never a
shared catalog.

## Fixture self-test (no token, no network)

```bash
SELF_TEST=1 npx tsx apps/api/test/muse-live-catalog-verify.ts
```

Injects a recorded fixture of the real Graph response shape:
catalog `{name: 'ClutchAgent Test Catalog'}`, products
`{data: [{name: 'Test - ClutchAgent Access', price: '1.00', currency: 'USD'}]}`
(no availability field → expects `availability: 'unknown'`,
`status: 'verified'`). All assertions pass in fixture mode.
