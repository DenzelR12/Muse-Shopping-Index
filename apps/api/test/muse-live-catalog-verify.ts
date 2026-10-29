/**
 * Server-side verification harness for the live Meta catalog read
 * through the repo client — Muse Shopping Index.
 *
 * What this is: a token-holder-run verification script, NOT a route.
 * It reads the Meta catalog through apps/api/src/meta-catalog.ts
 * (GET-only, read-only, tenant-gated) and checks the result against
 * the Graph Explorer proof (docs/live-meta-catalog-proof.md):
 * 1 TEST item, title/price/currency valid, raw IDs stripped.
 *
 * What this is NOT: a public route or endpoint. This file is never
 * mounted in index.ts. It never renders a review, signs a draft,
 * issues an approval, or executes a purchase.
 *
 * Token handling:
 * - META_CATALOG_ACCESS_TOKEN and META_CATALOG_ID come from
 *   process.env only. Neither value is ever printed, logged, or
 *   embedded in output — only presence is reported.
 * - SELF_TEST=1 runs a network-free fixture of the recorded Graph
 *   response shape (no token needed, no network call).
 *
 * Exit codes: 0 = all checks PASS, 1 = any check FAIL, 2 = config
 * gating (missing token / catalog ID / invalid config).
 *
 * Run:  META_CATALOG_ACCESS_TOKEN=... META_CATALOG_ID=... \
 *         npx tsx apps/api/test/muse-live-catalog-verify.ts
 * Self-test: SELF_TEST=1 npx tsx apps/api/test/muse-live-catalog-verify.ts
 */

import {
  resolveMetaCatalogConfig,
  createMetaCatalogGraphTransport,
  createMetaCatalogClient,
  readMetaCatalog,
  META_CATALOG_FRESHNESS_MS,
  type MetaCatalogTransport,
  type MetaCatalogReadResult,
  type MetaCatalogConfig,
  type MetaCatalogClient,
  type MetaCatalogFetchFn,
} from '../src/meta-catalog';

const SELF_TEST = process.env.SELF_TEST === '1';

// Recorded fixture matching the real Graph Explorer response shape
// from docs/live-meta-catalog-proof.md (values are the verified TEST
// item's display fields; no IDs, no token).
const FIXTURE_CATALOG = {name: 'ClutchAgent Test Catalog'};
const FIXTURE_PRODUCTS = {
  data: [{name: 'Test - ClutchAgent Access', price: '1.00', currency: 'USD'}],
};

function fixtureTransport(): MetaCatalogTransport {
  return {
    async get(url: string): Promise<unknown> {
      if (url.endsWith('/products')) return FIXTURE_PRODUCTS;
      return FIXTURE_CATALOG;
    },
  };
}

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

function main(): void {
  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail: string): void => {
    checks.push({name, pass, detail});
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  };

  let config: MetaCatalogConfig;
  let catalogId: string | null;

  if (SELF_TEST) {
    // Fixture mode: no network, no real token or catalog ID.
    config = {baseUrl: 'https://graph.facebook.com', version: 'v26.0', tokenConfigured: true};
    catalogId = 'SELF_TEST_FIXTURE';
  } else {
    const token = process.env.META_CATALOG_ACCESS_TOKEN?.trim();
    if (!token) {
      console.log('muse_catalog_not_configured');
      process.exit(2);
    }
    const id = process.env.META_CATALOG_ID?.trim();
    if (!id) {
      console.log('muse_catalog_id_not_configured');
      process.exit(2);
    }
    catalogId = id;
    try {
      config = resolveMetaCatalogConfig(process.env);
    } catch (err) {
      console.log(`config gating: ${(err as Error).message}`);
      process.exit(2);
    }
  }

  let client: MetaCatalogClient;
  if (SELF_TEST) {
    client = createMetaCatalogClient({
      transport: fixtureTransport(),
      baseUrl: config.baseUrl,
      version: config.version,
    });
  } else {
    const token = process.env.META_CATALOG_ACCESS_TOKEN?.trim() as string;
    const fetchImpl: MetaCatalogFetchFn = (url, init) => globalThis.fetch(url, init);
    client = createMetaCatalogClient({
      transport: createMetaCatalogGraphTransport({
        baseUrl: config.baseUrl,
        version: config.version,
        token,
        fetchImpl,
      }),
      baseUrl: config.baseUrl,
      version: config.version,
    });
  }

  console.log(`token: ${SELF_TEST ? 'fixture (no real token used)' : 'configured (presence only, value never shown)'}`);
  console.log(`catalog ID: ${SELF_TEST ? 'fixture (no real ID used)' : 'configured (presence only, value never shown)'}`);
  console.log(`mode: ${SELF_TEST ? 'SELF_TEST fixture' : 'LIVE read via repo client'}`);

  (async () => {
    let result: MetaCatalogReadResult;
    try {
      result = await readMetaCatalog({
        config,
        client,
        companyId: 'clutchagent',
        principalCompanyId: 'clutchagent',
        catalogId,
      });
    } catch (err) {
      console.log(`FAIL  read threw — ${(err as Error).message}`);
      process.exit(1);
    }

    const allItems = [...result.verified, ...result.unavailable, ...result.unverifiable];
    check(
      'exactly one item returned',
      allItems.length === 1,
      `verified=${result.verified.length} unavailable=${result.unavailable.length} unverifiable=${result.unverifiable.length}`,
    );

    const item = allItems[0] as
      | {title?: unknown; priceAmount?: unknown; currency?: unknown; availability?: unknown; status?: unknown}
      | undefined;
    const title = typeof item?.title === 'string' ? item.title : null;
    check('title non-empty', typeof title === 'string' && title.trim().length > 0, `title=${JSON.stringify(title)}`);

    const priceAmount = typeof item?.priceAmount === 'number' ? item.priceAmount : null;
    check('priceAmount > 0', typeof priceAmount === 'number' && priceAmount > 0, `priceAmount=${priceAmount}`);

    const currency = typeof item?.currency === 'string' ? item.currency : null;
    check(
      'currency is a 3-letter code',
      typeof currency === 'string' && /^[A-Z]{3}$/.test(currency),
      `currency=${JSON.stringify(currency)}`,
    );

    check('source label', result.source === 'META CATALOG', `source=${JSON.stringify(result.source)}`);
    check('TEST label', result.label.includes('TEST'), `label=${JSON.stringify(result.label)}`);

    const fetchedMs = Date.parse(result.fetchedAt);
    const validMs = Date.parse(result.validUntil);
    check(
      'freshness window is 24h',
      Number.isFinite(fetchedMs) &&
        Number.isFinite(validMs) &&
        validMs - fetchedMs === META_CATALOG_FRESHNESS_MS,
      `validUntil - fetchedAt = ${validMs - fetchedMs}ms`,
    );

    const serialized = JSON.stringify(result);
    const leaked = ['gid://', 'myshopid', 'acct_'].filter((marker) => serialized.includes(marker));
    check('raw IDs stripped', leaked.length === 0, leaked.length ? `leaked markers: ${leaked.join(', ')}` : 'no raw ID markers');

    // Redacted summary — display fields only, never token or catalog ID.
    console.log('--- redacted summary ---');
    console.log(`source: ${result.source}`);
    console.log(`label: ${result.label}`);
    console.log(`catalogName: ${result.catalogName}`);
    console.log(
      `counts: verified=${result.verified.length} unavailable=${result.unavailable.length} unverifiable=${result.unverifiable.length}`,
    );
    for (const v of result.verified) {
      console.log(`verified item: title=${JSON.stringify(v.title)} price=${v.priceAmount} currency=${v.currency} availability=${v.availability} status=${v.status}`);
    }
    for (const u of result.unavailable) {
      console.log(`unavailable item: title=${JSON.stringify(u.title)} price=${u.priceAmount} currency=${u.currency} availability=${u.availability} status=${u.status}`);
    }
    for (const x of result.unverifiable) {
      console.log(`unverifiable item: title=${JSON.stringify(x.title)} reason=${x.reason}`);
    }
    console.log(`fetchedAt: ${result.fetchedAt}`);
    console.log(`validUntil: ${result.validUntil}`);

    const failed = checks.filter((c) => !c.pass);
    console.log(failed.length === 0 ? 'ALL CHECKS PASS' : `${failed.length} CHECK(S) FAILED`);
    process.exit(failed.length === 0 ? 0 : 1);
  })().catch((err) => {
    console.log(`FAIL  unexpected error — ${(err as Error).message}`);
    process.exit(1);
  });
}

main();
