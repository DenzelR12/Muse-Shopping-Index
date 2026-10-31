/**
 * Operator harness for ONE Stripe TEST-MODE test order — Muse
 * Shopping Index.
 *
 * What this is: a token-holder-run operator script, NOT a route. It
 * runs the ClutchAgent test order end to end in Stripe TEST mode and
 * records a timestamped measured run:
 *   (1) read the ClutchAgent TEST catalog through the existing
 *       read-only Meta catalog client (meta-catalog.ts);
 *   (2) build the exact signed draft for the $1.00 USD test item via
 *       ZeroTrustConnectorRuntime + the Stripe test-mode adapter
 *       (muse-stripe-test-adapter.ts) — price comes only from the
 *       verified catalog read;
 *   (3) APPROVAL GATE: unless MUSE_TEST_ORDER_APPROVAL is set to a
 *       one-time operator code, the harness STOPS here, reports
 *       AWAITING_APPROVAL, writes the report, and exits 3 without
 *       executing anything. The code itself is never printed or
 *       written to the report — only its SHA-256 fingerprint;
 *   (4) claim the exactly-once guard under the Stripe idempotency
 *       key (gift-signal:test-order:<companyId>:<draftId>) — a
 *       duplicate run returns the original result and never charges
 *       twice;
 *   (5) execute through the runtime (consume-once approval, drift
 *       revalidation, single execution claim — all enforced by
 *       ZeroTrustConnectorRuntime before the adapter is reached);
 *   (6) record the provider result (test-mode PaymentIntent id and
 *       status) and finish the timestamped report.
 *
 * What this is NOT: a public route or endpoint. This file is never
 * mounted in index.ts. It cannot charge real money: the adapter
 * refuses Stripe live keys in code, and this harness only ever runs
 * the test-mode path.
 *
 * Secrets (process.env only, presence-only reporting, never printed):
 * - META_CATALOG_ACCESS_TOKEN, META_CATALOG_ID — the existing catalog
 *   env names (meta-catalog.ts).
 * - STRIPE_TEST_SECRET_KEY — must be a Stripe TEST key (sk_test_...).
 * - MUSE_STRIPE_TEST_ENABLED — must be '1' or 'true'.
 * - MUSE_TEST_ORDER_APPROVAL — the one-time operator approval code.
 * - MUSE_TEST_ORDER_QUANTITY — optional order quantity (integer
 *   1..99, default 1). Quantity is part of the draft's identity, so
 *   each quantity is a separate draft requiring its own approval.
 * - DRAFT_SIGNING_SECRET, APPROVAL_SIGNING_SECRET — the existing
 *   server signing secrets for drafts and approval tokens.
 * - DATABASE_URL — when present (and not SELF_TEST), the exactly-once
 *   claim uses Postgres; otherwise the single-process memory store.
 * - MUSE_GENERIC_ADAPTER_CONFIG_JSON — when present it must declare
 *   {"clutchagent":"stripe-test-mode"}; when absent this harness uses
 *   that single mapping as its documented default.
 * - MUSE_TEST_ORDER_REPORT_PATH — report location override. Default:
 *   ~/workspace/goals/muse-shopping-index/hidden_files/test-order-report.md
 *
 * SELF_TEST=1 runs fully offline: fixture catalog (the recorded Graph
 * response shape), a fixture Stripe transport, and fixture signing
 * secrets — no real token, key, or network call. In SELF_TEST the
 * approval gate defaults to a fixture code; set
 * MUSE_TEST_ORDER_NO_APPROVAL=1 to exercise the AWAITING_APPROVAL stop.
 *
 * RELEASE MODE — MUSE_TEST_ORDER_RELEASE_FAILED=1: after the same
 * config gating and the same catalog read + draft build (so the
 * deterministic draft id and claim key match the original run), the
 * harness releases the exactly-once claim left behind by a DEFINITE
 * provider failure (e.g. Stripe's 400 for a missing return_url: the
 * PaymentIntent create+confirm was refused before anything existed)
 * so the corrected order can run under a fresh approval. Release
 * requires TWO pieces of evidence and changes nothing without both:
 * (1) the stored claim is completed with result status FAILED and no
 * providerReference; (2) Stripe shows zero PaymentIntents for this
 * draft. Any gap — wrong claim state, a PaymentIntent found, or the
 * Stripe list call failing — stops with RELEASE_REFUSED, exit 1.
 * Release mode never executes a charge and never needs
 * MUSE_TEST_ORDER_APPROVAL. In SELF_TEST it seeds the memory store
 * with exactly that completed-FAILED claim and uses a fixture Stripe
 * list with zero PaymentIntents.
 *
 * Exit codes: 0 = order COMPLETED (or DUPLICATE with the original
 * result, or CLAIM_RELEASED in release mode), 1 = failure /
 * reconciliation required / claim in progress / RELEASE_REFUSED,
 * 2 = config gating, 3 = AWAITING_APPROVAL (nothing executed).
 */

import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {Pool} from 'pg';
import {
  MemoryConnectionAuthority,
  MemoryDraftAuthority,
  ZeroTrustConnectorRegistry,
  ZeroTrustConnectorRuntime,
  type ConnectorExecution,
  type CustomerConnection,
} from '@gift-signal/mcp-gateway';
import {InMemoryReplayStore, issueApprovalToken} from '@gift-signal/zero-trust';
import {
  createMetaCatalogClient,
  createMetaCatalogGraphTransport,
  readMetaCatalog,
  resolveMetaCatalogConfig,
  type MetaCatalogClient,
  type MetaCatalogConfig,
  type MetaCatalogFetchFn,
  type MetaCatalogReadResult,
  type MetaCatalogTransport,
} from '../src/meta-catalog';
import {parseGenericAdapterConfig} from '../src/live-activation';
import {
  MemoryExactlyOnceStore,
  PostgresExactlyOnceStore,
  executeExactlyOnce,
  type ExactlyOnceStore,
} from '../src/muse-exactly-once';
import {
  CLUTCHAGENT_COMPANY_ID,
  STRIPE_TEST_ADAPTER_ID,
  metaCatalogItemsToStripeTestOffers,
  registerStripeTestAdapter,
  resolveStripeTestConfig,
  stripeTestIdempotencyKey,
  type StripeTestFetchFn,
} from '../src/muse-stripe-test-adapter';

const SELF_TEST = process.env.SELF_TEST === '1';
const RELEASE_FAILED = process.env.MUSE_TEST_ORDER_RELEASE_FAILED === '1';
const COMPANY_ID = CLUTCHAGENT_COMPANY_ID;
const CONNECTION_ID = 'clutchagent-test-connection';
const SUBJECT_ID = 'operator-test-approver';

const FIXTURE_CATALOG = {name: 'ClutchAgent Test Catalog'};
const FIXTURE_PRODUCTS = {
  data: [{name: 'Test - ClutchAgent Access', price: '$1.00', currency: 'USD', availability: 'in stock'}],
};
const FIXTURE_STRIPE_KEY = 'sk_test_SELF_TEST_FIXTURE';
const FIXTURE_DRAFT_SECRET = 'self-test-draft-signing-secret';
const FIXTURE_APPROVAL_SECRET = 'self-test-approval-signing-secret';
const FIXTURE_APPROVAL_CODE = 'SELF_TEST_FIXTURE_OPERATOR_CODE';
const FIXTURE_PAYMENT_INTENT_ID = 'pi_test_fixture_1';

interface Step {
  step: string;
  at: string;
  status: string;
  detail: string;
}

const steps: Step[] = [];
function record(step: string, status: string, detail: string, at?: string): void {
  const entry = {step, at: at ?? new Date().toISOString(), status, detail};
  steps.push(entry);
  console.log(`${entry.at}  ${step}  ${status} — ${detail}`);
}

let finalStatus = 'STARTED';
let draftFacts: {draftId: string; total: number; currency: string; claimKey: string; quantity: number} | null = null;
let catalogFacts: {title: string; priceAmount: number; currency: string} | null = null;
let approvalFingerprint: string | null = null;
let executionFacts: {status: string; executionId?: string; providerReference?: string | null} | null = null;

function reportPath(): string {
  const override = process.env.MUSE_TEST_ORDER_REPORT_PATH?.trim();
  if (override) return override;
  return join(homedir(), 'workspace/goals/muse-shopping-index/hidden_files/test-order-report.md');
}

function buildReport(): string {
  const lines: string[] = [];
  lines.push('# Muse Shopping Index — Stripe TEST-MODE test order run');
  lines.push('');
  lines.push(`- Mode: ${SELF_TEST ? 'SELF_TEST fixture (no network, no real token or key)' : 'LIVE operator run (Stripe TEST mode only)'}`);
  lines.push(`- Final status: **${finalStatus}**`);
  if (catalogFacts) {
    lines.push(`- Catalog item (Meta catalog, TEST): "${catalogFacts.title}" — ${catalogFacts.priceAmount} ${catalogFacts.currency}`);
  }
  if (draftFacts) {
    lines.push(`- Draft: ${draftFacts.draftId} — quantity ${draftFacts.quantity} — total ${draftFacts.total} ${draftFacts.currency}`);
    lines.push(`- Exactly-once claim key (Stripe idempotency key): ${draftFacts.claimKey}`);
  }
  lines.push(`- Approval: ${approvalFingerprint ? `operator code present (sha256 fingerprint: ${approvalFingerprint})` : 'absent — nothing executed'}`);
  if (executionFacts) {
    lines.push(
      `- Execution: ${executionFacts.status}` +
        `${executionFacts.executionId ? `, executionId ${executionFacts.executionId}` : ''}` +
        `${executionFacts.providerReference ? `, provider reference (test PaymentIntent) ${executionFacts.providerReference}` : ''}`,
    );
  }
  lines.push('');
  lines.push('## Steps');
  lines.push('');
  lines.push('| Step | Timestamp (UTC) | Status | Detail |');
  lines.push('| --- | --- | --- | --- |');
  for (const s of steps) lines.push(`| ${s.step} | ${s.at} | ${s.status} | ${s.detail} |`);
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push(
    SELF_TEST
      ? '- SELF_TEST fixture run: fixture catalog and fixture Stripe transport; no network calls, no real money, no real secrets.'
      : '- Stripe TEST mode only: the adapter refuses live keys in code (sk_live_ is rejected at construction, registration, and execution). No real money moved.',
  );
  lines.push('- This report contains no secrets: the Stripe key, catalog token, signing secrets, and approval code are reported by presence or fingerprint only.');
  lines.push('- Amount and currency came only from the verified Meta catalog read and the signed draft built from it.');
  lines.push('');
  return lines.join('\n');
}

async function writeReport(): Promise<void> {
  const path = reportPath();
  const markdown = buildReport();
  try {
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, markdown, 'utf8');
    console.log(`report written: ${path}`);
  } catch {
    console.log('report write failed — full report follows on stdout');
    console.log(markdown);
  }
}

function fixtureCatalogTransport(): MetaCatalogTransport {
  return {
    async get(url: string): Promise<unknown> {
      if (url.includes('/products')) return FIXTURE_PRODUCTS;
      return FIXTURE_CATALOG;
    },
  };
}

/** Release-mode fixture: a Stripe PaymentIntent list containing zero intents. */
function fixtureStripeListFetch(): StripeTestFetchFn {
  const impl = async (): Promise<unknown> => ({
    ok: true,
    status: 200,
    json: async () => ({object: 'list', data: [] as Array<{metadata?: {draft_id?: string}}>}),
  });
  return impl as unknown as StripeTestFetchFn;
}

function fixtureStripeFetch(state: {calls: number; idempotencyKeys: string[]}): StripeTestFetchFn {
  const impl = async (_url: unknown, init?: {headers?: Record<string, string>; body?: unknown}): Promise<unknown> => {
    state.calls += 1;
    state.idempotencyKeys.push(init?.headers?.['idempotency-key'] ?? '');
    // Echo the requested amount/currency like Stripe would, so the
    // adapter's echo check exercises any quantity, not just $1.
    const params = new URLSearchParams(String(init?.body ?? ''));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: FIXTURE_PAYMENT_INTENT_ID,
        status: 'succeeded',
        amount: Number(params.get('amount') ?? 100),
        currency: params.get('currency') ?? 'usd',
      }),
    };
  };
  return impl as unknown as StripeTestFetchFn;
}

function configGating(message: string): Promise<never> {
  console.log(`config gating: ${message}`);
  finalStatus = 'CONFIG_GATING';
  return writeReport().then(() => process.exit(2));
}

async function main(): Promise<void> {
  // Quantity is part of the draft's identity (the adapter hashes it
  // into the draft id), so a different quantity is a different draft
  // with its own claim/idempotency key and its own exact approval.
  // MUSE_TEST_ORDER_QUANTITY: integer 1..99, default 1.
  const quantityRaw = process.env.MUSE_TEST_ORDER_QUANTITY?.trim();
  const quantity = quantityRaw === undefined || quantityRaw === '' ? 1 : Number(quantityRaw);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    await configGating('test_order_quantity_invalid');
  }
  // --- Config gating (exit 2, nothing executed) -------------------------
  let catalogConfig: MetaCatalogConfig;
  let catalogId: string | null;
  let catalogClient: MetaCatalogClient;
  let stripeEnv: NodeJS.ProcessEnv;
  let draftSecret: string;
  let approvalSecret: string;
  let adapterConfig: Record<string, string>;
  const stripeState = {calls: 0, idempotencyKeys: [] as string[]};
  let stripeFetch: StripeTestFetchFn | undefined;

  if (SELF_TEST) {
    catalogConfig = {baseUrl: 'https://graph.facebook.com', version: 'v26.0', tokenConfigured: true};
    catalogId = 'SELF_TEST_FIXTURE';
    catalogClient = createMetaCatalogClient({
      transport: fixtureCatalogTransport(),
      baseUrl: catalogConfig.baseUrl,
      version: catalogConfig.version,
    });
    stripeEnv = {...process.env, MUSE_STRIPE_TEST_ENABLED: '1', STRIPE_TEST_SECRET_KEY: FIXTURE_STRIPE_KEY};
    stripeFetch = fixtureStripeFetch(stripeState);
    draftSecret = FIXTURE_DRAFT_SECRET;
    approvalSecret = FIXTURE_APPROVAL_SECRET;
    adapterConfig = {[COMPANY_ID]: STRIPE_TEST_ADAPTER_ID};
  } else {
    if (!process.env.META_CATALOG_ACCESS_TOKEN?.trim()) await configGating('muse_catalog_not_configured');
    if (!process.env.META_CATALOG_ID?.trim()) await configGating('muse_catalog_id_not_configured');
    catalogId = process.env.META_CATALOG_ID?.trim() as string;
    try {
      catalogConfig = resolveMetaCatalogConfig(process.env);
    } catch (err) {
      await configGating((err as Error).message);
      throw err; // unreachable — configGating exits; satisfies definite assignment
    }
    const fetchImpl: MetaCatalogFetchFn = (url, init) => globalThis.fetch(url, init);
    catalogClient = createMetaCatalogClient({
      transport: createMetaCatalogGraphTransport({
        baseUrl: catalogConfig.baseUrl,
        version: catalogConfig.version,
        token: process.env.META_CATALOG_ACCESS_TOKEN?.trim() as string,
        fetchImpl,
      }),
      baseUrl: catalogConfig.baseUrl,
      version: catalogConfig.version,
    });
    const stripeConfig = resolveStripeTestConfig(process.env);
    if (!stripeConfig.enabled) await configGating('muse_stripe_test_disabled');
    if (stripeConfig.keyShape === 'missing') await configGating('muse_stripe_test_key_missing');
    if (stripeConfig.keyShape === 'live') await configGating('muse_stripe_test_live_key_refused');
    if (stripeConfig.keyShape !== 'test') await configGating('muse_stripe_test_key_invalid');
    stripeEnv = process.env;
    if (!process.env.DRAFT_SIGNING_SECRET?.trim() || !process.env.APPROVAL_SIGNING_SECRET?.trim()) {
      await configGating('test_order_signing_secrets_not_configured');
    }
    draftSecret = process.env.DRAFT_SIGNING_SECRET as string;
    approvalSecret = process.env.APPROVAL_SIGNING_SECRET as string;
    if (process.env.MUSE_GENERIC_ADAPTER_CONFIG_JSON?.trim()) {
      try {
        adapterConfig = parseGenericAdapterConfig(process.env.MUSE_GENERIC_ADAPTER_CONFIG_JSON);
      } catch {
        await configGating('live_activation_generic_adapter_config_invalid');
        throw new Error('live_activation_generic_adapter_config_invalid'); // unreachable — configGating exits
      }
    } else {
      adapterConfig = {[COMPANY_ID]: STRIPE_TEST_ADAPTER_ID};
      console.log('adapter config: harness default (clutchagent -> stripe-test-mode); MUSE_GENERIC_ADAPTER_CONFIG_JSON not set');
    }
  }
  console.log(`mode: ${SELF_TEST ? 'SELF_TEST fixture' : 'LIVE operator run — Stripe TEST mode'}`);
  console.log('secrets: presence only, values never shown (catalog token, Stripe test key, signing secrets, approval code)');

  // --- Step 1: read the ClutchAgent TEST catalog ------------------------
  let catalogResult: MetaCatalogReadResult;
  try {
    catalogResult = await readMetaCatalog({
      config: catalogConfig,
      client: catalogClient,
      companyId: COMPANY_ID,
      principalCompanyId: COMPANY_ID,
      catalogId,
    });
  } catch (err) {
    record('catalog_read', 'FAIL', (err as Error).message);
    finalStatus = 'FAILED';
    await writeReport();
    process.exit(1);
  }
  const testItem = catalogResult.verified.find((item) => item.priceAmount === 1 && item.currency === 'USD');
  if (!testItem) {
    record('catalog_read', 'FAIL', `verified $1.00 USD test item not found (verified=${catalogResult.verified.length})`);
    finalStatus = 'FAILED';
    await writeReport();
    process.exit(1);
  }
  catalogFacts = {title: testItem.title, priceAmount: testItem.priceAmount, currency: testItem.currency};
  record(
    'catalog_read',
    'PASS',
    `catalog "${catalogResult.catalogName}" — verified test item "${testItem.title}" ${testItem.priceAmount} ${testItem.currency}`,
  );

  // --- Step 2: build the exact signed draft -----------------------------
  const offers = metaCatalogItemsToStripeTestOffers(catalogResult.verified, catalogResult.fetchedAt);
  const offer = offers.find((candidate) => candidate.title === testItem.title);
  if (!offer) {
    record('draft_built', 'FAIL', 'verified item did not map to a connector offer');
    finalStatus = 'FAILED';
    await writeReport();
    process.exit(1);
  }
  const registry = new ZeroTrustConnectorRegistry();
  const registration = registerStripeTestAdapter({
    registry,
    env: stripeEnv,
    adapterConfig,
    resolveOffers: async () =>
      metaCatalogItemsToStripeTestOffers(
        (
          await readMetaCatalog({
            config: catalogConfig,
            client: catalogClient,
            companyId: COMPANY_ID,
            principalCompanyId: COMPANY_ID,
            catalogId,
          })
        ).verified,
        new Date().toISOString(),
      ),
    fetchImpl: stripeFetch,
  });
  if (!registration.registered) {
    record('draft_built', 'FAIL', `adapter registration refused: ${registration.reason ?? 'unknown'}`);
    finalStatus = 'FAILED';
    await writeReport();
    process.exit(1);
  }
  const connections = new MemoryConnectionAuthority();
  const connection: CustomerConnection = {
    connectionId: CONNECTION_ID,
    companyId: COMPANY_ID,
    subjectId: SUBJECT_ID,
    grantedActions: ['search_offers', 'create_action_draft', 'execute_action'],
    secretRef: 'operator-test-harness',
    createdAt: new Date().toISOString(),
  };
  connections.put(connection);
  const drafts = new MemoryDraftAuthority();
  const runtime = new ZeroTrustConnectorRuntime(
    registry,
    connections,
    drafts,
    new InMemoryReplayStore(),
    {draftSigningSecret: draftSecret, approvalSigningSecret: approvalSecret},
  );
  let draft: {draftId: string; total: number; currency: string; expiresAt: string};
  let draftHash: string;
  try {
    const created = await runtime.createDraft(COMPANY_ID, CONNECTION_ID, {
      offerIds: [offer.offerId],
      quantity,
      kind: 'PURCHASE',
    });
    draft = created.draft;
    const envelope = await drafts.get(draft.draftId);
    if (!envelope) throw new Error('draft_envelope_missing');
    draftHash = envelope.payloadHash;
  } catch (err) {
    record('draft_built', 'FAIL', (err as Error).message);
    finalStatus = 'FAILED';
    await writeReport();
    process.exit(1);
  }
  const claimKey = stripeTestIdempotencyKey(COMPANY_ID, draft.draftId);
  draftFacts = {draftId: draft.draftId, total: draft.total, currency: draft.currency, claimKey, quantity};
  record('draft_built', 'PASS', `draft ${draft.draftId} — quantity ${quantity} — total ${draft.total} ${draft.currency} (from the verified catalog read only)`);

  // --- Release mode: release a completed definite-failure claim -------
  // Entered only with MUSE_TEST_ORDER_RELEASE_FAILED=1, after the same
  // config gating and the same catalog read + draft build above, so the
  // deterministic draft id and claim key are identical to the failed
  // run. Both evidence checks must pass or nothing changes; this mode
  // never executes a charge and never needs an approval code.
  if (RELEASE_FAILED) {
    const store: ExactlyOnceStore =
      !SELF_TEST && process.env.DATABASE_URL?.trim()
        ? new PostgresExactlyOnceStore(new Pool({connectionString: process.env.DATABASE_URL}))
        : new MemoryExactlyOnceStore();
    if (SELF_TEST) {
      // Seed the exact state a definite live failure leaves behind: a
      // completed claim whose result is FAILED with no provider ref.
      const seeded = await store.claim({key: claimKey, companyId: COMPANY_ID, draftId: draft.draftId, operation: 'stripe_test_order'});
      if (seeded.outcome !== 'won') {
        record('claim_evidence', 'FAIL', `self-test seed claim outcome ${seeded.outcome} — expected won`);
        finalStatus = 'FAILED';
        await writeReport();
        process.exit(1);
      }
      await store.complete({
        key: claimKey,
        companyId: COMPANY_ID,
        result: {status: 'FAILED', executionId: `stripe-test-exec-${draft.draftId}`, providerReference: null},
      });
      console.log('PASS  self-test release seed — completed FAILED claim (providerReference null) stored for the fixture draft');
    }
    // Evidence 1: the stored claim itself is a completed definite failure.
    const stored = await store.getClaim({key: claimKey, companyId: COMPANY_ID});
    const storedResult = stored?.result as {status?: string; providerReference?: string | null} | undefined;
    const claimEvidenceOk =
      stored?.status === 'completed' &&
      storedResult?.status === 'FAILED' &&
      (storedResult?.providerReference === null || storedResult?.providerReference === undefined);
    if (!claimEvidenceOk) {
      record(
        'claim_evidence',
        'STOP',
        `stored claim is not a completed definite failure (claim ${stored?.status ?? 'absent'}, result status ${storedResult?.status ?? 'none'}, provider reference ${storedResult?.providerReference ?? 'none'}) — RELEASE_REFUSED, nothing changed`,
      );
      finalStatus = 'RELEASE_REFUSED';
      await writeReport();
      process.exit(1);
    }
    record('claim_evidence', 'PASS', 'stored claim is completed, result status FAILED, no provider reference — definite failure, nothing was created');
    // Evidence 2: Stripe itself shows no PaymentIntent for this draft.
    let matchingIntents: number;
    try {
      const listFetch: StripeTestFetchFn = SELF_TEST ? fixtureStripeListFetch() : (stripeFetch ?? (globalThis.fetch as StripeTestFetchFn));
      const listKey = SELF_TEST ? FIXTURE_STRIPE_KEY : (process.env.STRIPE_TEST_SECRET_KEY as string);
      const listResponse = await listFetch('https://api.stripe.com/v1/payment_intents?limit=100', {
        method: 'GET',
        headers: {authorization: `Bearer ${listKey}`},
      });
      if (!listResponse.ok) throw new Error(`stripe_list_http_${listResponse.status}`);
      const listPayload = (await listResponse.json()) as {data?: Array<{metadata?: {draft_id?: string}}>};
      matchingIntents = (listPayload.data ?? []).filter((intent) => intent.metadata?.draft_id === draft.draftId).length;
    } catch (err) {
      record('stripe_evidence', 'STOP', `Stripe PaymentIntent list failed (${(err as Error).message}) — no evidence, no release; RELEASE_REFUSED, nothing changed`);
      finalStatus = 'RELEASE_REFUSED';
      await writeReport();
      process.exit(1);
    }
    if (matchingIntents > 0) {
      record('stripe_evidence', 'STOP', `${matchingIntents} PaymentIntent(s) found for draft ${draft.draftId} in Stripe test mode — RELEASE_REFUSED, nothing changed`);
      finalStatus = 'RELEASE_REFUSED';
      await writeReport();
      process.exit(1);
    }
    record('stripe_evidence', 'PASS', `0 PaymentIntents found for draft ${draft.draftId} in Stripe test mode`);
    const released = await store.releaseCompletedFailure({key: claimKey, companyId: COMPANY_ID});
    if (!released) {
      record('claim_released', 'STOP', 'the store guard refused the release — RELEASE_REFUSED, nothing changed');
      finalStatus = 'RELEASE_REFUSED';
      await writeReport();
      process.exit(1);
    }
    record('claim_released', 'PASS', 'completed FAILED claim released on evidence — the same draft may be executed again under a fresh exact approval');
    if (SELF_TEST) console.log('PASS  self-test release mode — claim released on fixture evidence, CLAIM_RELEASED');
    finalStatus = 'CLAIM_RELEASED';
    await writeReport();
    process.exit(0);
  }

  // --- Step 3: approval gate ---------------------------------------------
  const approvalCode = SELF_TEST
    ? process.env.MUSE_TEST_ORDER_NO_APPROVAL === '1'
      ? undefined
      : (process.env.MUSE_TEST_ORDER_APPROVAL?.trim() ?? FIXTURE_APPROVAL_CODE)
    : process.env.MUSE_TEST_ORDER_APPROVAL?.trim();
  if (!approvalCode) {
    record('approval_gate', 'STOP', 'MUSE_TEST_ORDER_APPROVAL not set — AWAITING_APPROVAL, nothing executed');
    finalStatus = 'AWAITING_APPROVAL';
    await writeReport();
    process.exit(3);
  }
  approvalFingerprint = createHash('sha256').update(approvalCode).digest('hex').slice(0, 12);
  const approvalToken = issueApprovalToken(
    {
      subjectId: SUBJECT_ID,
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      draftId: draft.draftId,
      draftHash,
      amount: draft.total,
      currency: draft.currency,
      expiresAt: draft.expiresAt,
    },
    approvalSecret,
  );
  record('approval_gate', 'PASS', `operator approval code present (fingerprint ${approvalFingerprint}); signed approval token issued for the exact draft`);

  // --- Steps 4–6: exactly-once claim, execution, provider result --------
  const store: ExactlyOnceStore =
    !SELF_TEST && process.env.DATABASE_URL?.trim()
      ? new PostgresExactlyOnceStore(new Pool({connectionString: process.env.DATABASE_URL}))
      : new MemoryExactlyOnceStore();
  const claimedAt = new Date().toISOString();
  let executionStartedAt: string | null = null;
  let execution: ConnectorExecution | null = null;
  let handlerError: string | null = null;
  let outcome: Awaited<ReturnType<typeof executeExactlyOnce<{status: string; executionId?: string; providerReference?: string | null}>>>;
  try {
    outcome = await executeExactlyOnce(
      store,
      {key: claimKey, companyId: COMPANY_ID, draftId: draft.draftId, operation: 'stripe_test_order'},
      async () => {
        executionStartedAt = new Date().toISOString();
        try {
          execution = await runtime.execute(COMPANY_ID, CONNECTION_ID, {draftId: draft.draftId, approvalToken});
          return {
            result: {
              status: execution.status,
              executionId: execution.executionId,
              providerReference: execution.providerReference ?? null,
            },
          };
        } catch (err) {
          const message = (err as Error).message;
          if (message.includes('reconciliation')) {
            return {result: {status: 'UNCERTAIN', executionId: undefined, providerReference: null}, uncertain: true};
          }
          handlerError = message;
          throw err;
        }
      },
    );
  } catch (err) {
    // A non-uncertain execution error: by design the exactly-once claim
    // is left in progress (never auto-released on an error alone).
    record('exactly_once_claim', 'WON_THEN_ERROR', `claim won, execution errored: ${handlerError ?? (err as Error).message}; claim left in progress`, claimedAt);
    if (executionStartedAt) record('execution', 'FAIL', handlerError ?? (err as Error).message, executionStartedAt);
    record('provider_result', 'NONE', 'no provider result recorded');
    finalStatus = 'FAILED';
    await writeReport();
    process.exit(1);
  }

  if (!outcome.executed) {
    if (outcome.outcome === 'duplicate') {
      const prior = outcome.result as {status?: string; executionId?: string; providerReference?: string | null} | undefined;
      record('exactly_once_claim', 'DUPLICATE', 'this exact order was already executed — original result returned, no second charge', claimedAt);
      record('provider_result', 'DUPLICATE', `prior status ${prior?.status ?? 'unknown'}${prior?.providerReference ? `, provider reference ${prior.providerReference}` : ''}`);
      executionFacts = {status: prior?.status ?? 'unknown', executionId: prior?.executionId, providerReference: prior?.providerReference};
      finalStatus = 'DUPLICATE';
      await writeReport();
      process.exit(0);
    }
    record('exactly_once_claim', outcome.outcome.toUpperCase(), `claim outcome ${outcome.outcome} — execution not attempted`, claimedAt);
    record('provider_result', 'NONE', 'no provider result recorded');
    finalStatus = outcome.outcome === 'stale_reconcile' ? 'RECONCILIATION_REQUIRED' : 'IN_PROGRESS';
    await writeReport();
    process.exit(1);
  }

  record('exactly_once_claim', 'WON', `claim won under ${claimKey}`, claimedAt);
  if (executionStartedAt) {
    record(
      'execution',
      execution?.status === 'CONFIRMED' ? 'PASS' : 'FAIL',
      `runtime execution ${execution?.status ?? 'unknown'}${execution ? ` — ${execution.message}` : ''}`,
      executionStartedAt,
    );
  }
  if (outcome.outcome === 'stale_reconcile') {
    record('provider_result', 'UNCERTAIN', 'provider outcome uncertain — reconciliation required, never retried blindly');
    finalStatus = 'RECONCILIATION_REQUIRED';
    await writeReport();
    process.exit(1);
  }
  const result = outcome.result as {status: string; executionId?: string; providerReference?: string | null};
  executionFacts = result;
  record(
    'provider_result',
    result.status === 'CONFIRMED' ? 'PASS' : 'FAIL',
    `test-mode PaymentIntent ${result.providerReference ?? 'none'} — status ${result.status}`,
  );
  if (SELF_TEST) {
    const keyOk = stripeState.idempotencyKeys.length === 1 && stripeState.idempotencyKeys[0] === claimKey;
    console.log(`${keyOk ? 'PASS' : 'FAIL'}  self-test idempotency key — ${stripeState.idempotencyKeys[0] ?? 'none'} (Stripe calls: ${stripeState.calls})`);
    if (!keyOk) {
      finalStatus = 'FAILED';
      await writeReport();
      process.exit(1);
    }
  }
  finalStatus = result.status === 'CONFIRMED' ? 'COMPLETED' : 'FAILED';
  console.log(finalStatus === 'COMPLETED' ? 'TEST ORDER COMPLETED' : 'TEST ORDER FAILED');
  await writeReport();
  process.exit(finalStatus === 'COMPLETED' ? 0 : 1);
}

main().catch(async (err) => {
  console.log(`FAIL  unexpected error — ${(err as Error).message}`);
  finalStatus = 'FAILED';
  await writeReport();
  process.exit(1);
});
