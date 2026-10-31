import {createHash} from 'node:crypto';
import {currencyAmountToMinorUnits} from '@gift-signal/payments';
import {
  defaultConnectorActions,
  type CompanyConnectorManifest,
  type ConnectorActionDraft,
  type ConnectorExecution,
  type CustomerConnection,
  type NormalizedOffer,
  type OfferSearchRequest,
  type ZeroTrustConnectorAdapter,
  type ZeroTrustConnectorRegistry,
} from '@gift-signal/mcp-gateway';
import type {MetaCatalogConsumerItem} from './meta-catalog.js';

/**
 * Stripe TEST-MODE execution adapter — Muse Shopping Index.
 *
 * Muse feature, not a storefront. This module is the in-process
 * connector adapter that lets ONE company — ClutchAgent, the Muse
 * Meta tenant — execute ONE kind of order end to end in Stripe TEST
 * mode: the $1.00 TEST catalog item whose price was verified through
 * the read-only Meta catalog client (meta-catalog.ts). It exists so a
 * single test-mode order can be run with timestamps (draft ->
 * approval -> execution -> provider confirmation) as a measured
 * result. It is not a live payment path and must never become one by
 * configuration alone:
 *
 * HARD GATES (all fail closed, checked at construction AND at
 * registration; the key is re-validated before every provider call):
 * - MUSE_STRIPE_TEST_ENABLED must be explicitly set ('1' or 'true'),
 *   otherwise the adapter refuses to construct:
 *   muse_stripe_test_disabled.
 * - STRIPE_TEST_SECRET_KEY must be present: muse_stripe_test_key_missing.
 * - The key must be a Stripe TEST key (sk_test_ prefix). A live key
 *   (sk_live_) is refused outright: muse_stripe_test_live_key_refused.
 *   Any other shape is refused: muse_stripe_test_key_invalid. There
 *   is no fallback, no live-key path, and no code path in this module
 *   that can charge real money.
 * - Registration additionally requires the operator to declare this
 *   company in MUSE_GENERIC_ADAPTER_CONFIG_JSON with this adapter's
 *   id (see live-activation.ts / muse-generic-profile.ts): config
 *   alone never creates the adapter, and this module never registers
 *   itself over HTTP or from a request body.
 *
 * EXECUTION RULES (the platform safety model, unchanged):
 * - Amount and currency come ONLY from the signed ConnectorActionDraft
 *   built from the verified catalog read (adapter createDraft prices
 *   from resolveOffers, which the operator wires to readMetaCatalog).
 *   No caller, model, caption, or browser input can supply an amount:
 *   createDraft accepts offerIds + quantity only.
 * - The provider call is a Stripe test-mode PaymentIntent confirmed
 *   with Stripe's TEST payment method pm_card_visa, over the Stripe
 *   HTTPS API, following services/payments conventions: form-encoded
 *   body, Bearer key, and an idempotency key with the existing
 *   `gift-signal:` prefix — gift-signal:test-order:<companyId>:<draftId>.
 *   That prefix is an operator contract (renaming it would break
 *   Stripe idempotency dedup semantics); it is never renamed here.
 * - Approval, consume-once, drift revalidation, and the single
 *   execution claim are enforced by ZeroTrustConnectorRuntime BEFORE
 *   this adapter's execute() is reached: revalidate() reprices from a
 *   fresh catalog read, and any change makes the runtime reject with
 *   provider_state_changed_reapproval_required before any charge.
 * - An uncertain provider outcome (network failure, 5xx/429, a
 *   'processing' intent, or a provider echo that does not match the
 *   draft) throws execution_uncertain_reconciliation_required. It is
 *   never retried blindly and never turned into a second charge: the
 *   Stripe idempotency key above makes reconciliation safe.
 * - A definite provider refusal (4xx card/payment error, or a
 *   terminal non-success intent status) returns a FAILED execution.
 * - Secrets are never logged, returned, or embedded in output: the
 *   config view below is presence/shape booleans only.
 */

export const CLUTCHAGENT_COMPANY_ID = 'clutchagent';
export const STRIPE_TEST_ADAPTER_ID = 'stripe-test-mode';
export const STRIPE_TEST_PAYMENT_METHOD = 'pm_card_visa';
export const STRIPE_TEST_MODE_LABEL = 'TEST — Stripe test mode, no real money';

export interface StripeTestConfig {
  enabled: boolean;
  keyConfigured: boolean;
  /** Shape only — never the value. */
  keyShape: 'test' | 'live' | 'malformed' | 'missing';
}

/** Presence/shape-only view of the Stripe test environment. Never returns a key value. */
export function resolveStripeTestConfig(env: NodeJS.ProcessEnv): StripeTestConfig {
  const rawEnabled = env.MUSE_STRIPE_TEST_ENABLED?.trim().toLowerCase();
  const enabled = rawEnabled === '1' || rawEnabled === 'true';
  const key = env.STRIPE_TEST_SECRET_KEY?.trim();
  const keyShape: StripeTestConfig['keyShape'] = !key
    ? 'missing'
    : key.startsWith('sk_test_')
      ? 'test'
      : key.startsWith('sk_live_')
        ? 'live'
        : 'malformed';
  return {enabled, keyConfigured: Boolean(key), keyShape};
}

/** The one place the test-mode key gates live. Throws fail-closed codes. */
export function assertStripeTestKeyUsable(config: StripeTestConfig): void {
  if (!config.enabled) throw new Error('muse_stripe_test_disabled');
  if (config.keyShape === 'missing') throw new Error('muse_stripe_test_key_missing');
  if (config.keyShape === 'live') throw new Error('muse_stripe_test_live_key_refused');
  if (config.keyShape !== 'test') throw new Error('muse_stripe_test_key_invalid');
}

/** Stripe idempotency key for a test order — existing `gift-signal:` prefix, never renamed. */
export function stripeTestIdempotencyKey(companyId: string, draftId: string): string {
  return `gift-signal:test-order:${companyId}:${draftId}`;
}

/**
 * Connector manifest for the ClutchAgent TEST execution path. The
 * display name and every offer/draft string carry the TEST label:
 * this manifest describes a test-mode harness registration, not a
 * commercial seller enrollment.
 */
export const clutchAgentStripeTestManifest: CompanyConnectorManifest = {
  companyId: CLUTCHAGENT_COMPANY_ID,
  slug: 'clutchagent',
  displayName: 'ClutchAgent (TEST — Stripe test mode)',
  vertical: 'services',
  status: 'ACTIVE',
  actions: defaultConnectorActions,
};

/**
 * Map verified Meta catalog items (display fields only — the catalog
 * client strips raw provider IDs) to connector offers. The offerId is
 * derived from the verified title + currency: it is a local test
 * handle, NOT a provider ID, and it is stable across reads of the
 * same verified item so drafts and idempotency keys stay stable.
 */
export function metaCatalogItemsToStripeTestOffers(
  items: readonly MetaCatalogConsumerItem[],
  evidenceAt: string
): NormalizedOffer[] {
  return items
    .filter((item) => item.status === 'verified')
    .map((item) => ({
      offerId: `catalog-${createHash('sha256').update(`${item.title}\n${item.currency}`).digest('hex').slice(0, 16)}`,
      title: item.title,
      provider: 'ClutchAgent (TEST)',
      price: item.priceAmount,
      currency: item.currency,
      availability: 'AVAILABLE' as const,
      evidenceAt,
    }));
}

export type StripeTestFetchFn = typeof fetch;

export interface StripeTestAdapterOptions {
  /** The Stripe secret key VALUE — held in memory only, never logged or returned. */
  secretKey: string;
  /** From MUSE_STRIPE_TEST_ENABLED via resolveStripeTestConfig. */
  enabled: boolean;
  /** Verified offers only — wired by the operator to the Meta catalog read. */
  resolveOffers: () => Promise<NormalizedOffer[]>;
  fetchImpl?: StripeTestFetchFn;
  now?: () => Date;
  /** Draft lifetime; defaults to 10 minutes (matches the approval window). */
  expiresInMs?: number;
}

interface StripePaymentIntentPayload {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  error?: {code?: string};
}

export class StripeTestModeConnectorAdapter implements ZeroTrustConnectorAdapter {
  readonly idempotentCommit: true = true;
  private readonly secretKey: string;
  private readonly resolveOffers: () => Promise<NormalizedOffer[]>;
  private readonly fetchImpl: StripeTestFetchFn;
  private readonly now: () => Date;
  private readonly expiresInMs: number;
  private readonly executed = new Map<string, ConnectorExecution>();

  constructor(options: StripeTestAdapterOptions) {
    assertStripeTestKeyUsable({
      enabled: options.enabled,
      keyConfigured: Boolean(options.secretKey?.trim()),
      keyShape: !options.secretKey?.trim()
        ? 'missing'
        : options.secretKey.trim().startsWith('sk_test_')
          ? 'test'
          : options.secretKey.trim().startsWith('sk_live_')
            ? 'live'
            : 'malformed',
    });
    this.secretKey = options.secretKey.trim();
    this.resolveOffers = options.resolveOffers;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.expiresInMs = options.expiresInMs ?? 10 * 60 * 1000;
  }

  async search(request: OfferSearchRequest, connection: CustomerConnection): Promise<NormalizedOffer[]> {
    void connection;
    const offers = await this.resolveOffers();
    const query = request.query?.trim().toLowerCase();
    if (!query) return offers;
    return offers.filter((offer) => offer.title.toLowerCase().includes(query));
  }

  async createDraft(args: {
    offerIds: string[];
    quantity: number;
    kind: 'PURCHASE' | 'BOOKING';
    connection: CustomerConnection;
  }): Promise<ConnectorActionDraft> {
    const offers = await this.resolveOffers();
    const chosen = args.offerIds.map((offerId) => {
      const found = offers.find((offer) => offer.offerId === offerId);
      if (!found) throw new Error('stripe_test_offer_not_found');
      return found;
    });
    if (!chosen.length) throw new Error('at_least_one_offer_required');
    const currency = chosen[0].currency;
    if (chosen.some((offer) => offer.currency !== currency)) {
      throw new Error('stripe_test_offer_currency_mismatch');
    }
    // Price comes only from the verified offers — never from the caller.
    const total = chosen.reduce((sum, offer) => sum + offer.price, 0) * args.quantity;
    const now = this.now();
    const draftId = `stripe-test-${createHash('sha256')
      .update(
        JSON.stringify({
          companyId: CLUTCHAGENT_COMPANY_ID,
          connectionId: args.connection.connectionId,
          offerIds: [...args.offerIds].sort(),
          quantity: args.quantity,
          kind: args.kind,
        })
      )
      .digest('hex')
      .slice(0, 24)}`;
    return {
      draftId,
      companyId: CLUTCHAGENT_COMPANY_ID,
      connectionId: args.connection.connectionId,
      kind: args.kind,
      offerIds: [...args.offerIds],
      quantity: args.quantity,
      total,
      currency,
      summary: `${STRIPE_TEST_MODE_LABEL}: ${chosen.map((offer) => offer.title).join(', ')}`,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.expiresInMs).toISOString(),
      approvalRequired: true,
      liveRevalidationRequired: true,
    };
  }

  /**
   * Reprice from a fresh verified read. If the total or currency moved,
   * return the draft with the new facts so ZeroTrustConnectorRuntime's
   * payload-hash comparison rejects execution as drift
   * (provider_state_changed_reapproval_required) before any charge.
   */
  async revalidate(draft: ConnectorActionDraft, connection: CustomerConnection): Promise<ConnectorActionDraft> {
    void connection;
    const offers = await this.resolveOffers();
    const chosen = draft.offerIds.map((offerId) => {
      const found = offers.find((offer) => offer.offerId === offerId);
      if (!found) throw new Error('stripe_test_offer_unavailable_at_revalidation');
      return found;
    });
    const currency = chosen[0]?.currency;
    const total = chosen.reduce((sum, offer) => sum + offer.price, 0) * draft.quantity;
    if (total === draft.total && currency === draft.currency) {
      return structuredClone(draft);
    }
    return {...draft, total, currency: currency ?? draft.currency};
  }

  async execute(args: {
    draft: ConnectorActionDraft;
    connection: CustomerConnection;
    approval: {approved: true; approvedAt: string; approvalId: string};
  }): Promise<ConnectorExecution> {
    void args.connection;
    void args.approval;
    const {draft} = args;
    if (draft.companyId !== CLUTCHAGENT_COMPANY_ID) {
      throw new Error('stripe_test_company_mismatch');
    }
    const existing = this.executed.get(draft.draftId);
    if (existing) return {...existing};
    // Defense in depth: the key that was gated at construction is the
    // only key this adapter can ever hold, and it is re-checked here.
    if (!this.secretKey.startsWith('sk_test_')) {
      throw new Error('muse_stripe_test_live_key_refused');
    }
    const amountCents = currencyAmountToMinorUnits(draft.total, draft.currency);
    const body = new URLSearchParams({
      amount: String(amountCents),
      currency: draft.currency.toLowerCase(),
      payment_method: STRIPE_TEST_PAYMENT_METHOD,
      confirm: 'true',
      description: `Muse Shopping Index TEST order — ${draft.summary}`,
      'metadata[company_id]': draft.companyId,
      'metadata[draft_id]': draft.draftId,
      'metadata[mode]': 'test',
    });
    let response: Awaited<ReturnType<StripeTestFetchFn>>;
    try {
      response = await this.fetchImpl('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
          'idempotency-key': stripeTestIdempotencyKey(draft.companyId, draft.draftId),
        },
        body,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      // Network failure / timeout: the provider may or may not have
      // processed the request. Uncertain — reconcile, never retry.
      throw new Error('execution_uncertain_reconciliation_required');
    }
    let payload: StripePaymentIntentPayload;
    try {
      payload = (await response.json()) as StripePaymentIntentPayload;
    } catch {
      throw new Error('execution_uncertain_reconciliation_required');
    }
    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) {
        throw new Error('execution_uncertain_reconciliation_required');
      }
      // Definite provider refusal (card/payment/parameter error).
      const failed: ConnectorExecution = {
        executionId: `stripe-test-exec-${draft.draftId}`,
        draftId: draft.draftId,
        status: 'FAILED',
        ...(payload.id ? {providerReference: payload.id} : {}),
        committedAt: this.now().toISOString(),
        message: `Stripe test-mode payment refused: ${payload.error?.code ?? `http_${response.status}`}`,
      };
      this.executed.set(draft.draftId, failed);
      return {...failed};
    }
    if (!payload.id || !/^pi_[A-Za-z0-9_]+$/.test(payload.id)) {
      throw new Error('execution_uncertain_reconciliation_required');
    }
    if (payload.amount !== amountCents || payload.currency !== draft.currency.toLowerCase()) {
      // The provider's echo does not match the approved draft.
      throw new Error('execution_uncertain_reconciliation_required');
    }
    if (payload.status === 'processing') {
      throw new Error('execution_uncertain_reconciliation_required');
    }
    if (payload.status !== 'succeeded') {
      const failed: ConnectorExecution = {
        executionId: `stripe-test-exec-${draft.draftId}`,
        draftId: draft.draftId,
        status: 'FAILED',
        providerReference: payload.id,
        committedAt: this.now().toISOString(),
        message: `Stripe test-mode payment not completed: ${payload.status ?? 'unknown_status'}`,
      };
      this.executed.set(draft.draftId, failed);
      return {...failed};
    }
    const execution: ConnectorExecution = {
      executionId: `stripe-test-exec-${draft.draftId}`,
      draftId: draft.draftId,
      status: 'CONFIRMED',
      providerReference: payload.id,
      committedAt: this.now().toISOString(),
      message: `${STRIPE_TEST_MODE_LABEL}: PaymentIntent confirmed for the verified ClutchAgent test item.`,
    };
    this.executed.set(draft.draftId, execution);
    return {...execution};
  }
}

/**
 * Startup registration — the ONLY way this adapter enters a registry.
 * Called from server startup code (index.ts) and from the operator
 * test-order harness, never from a request handler. Every gate must
 * pass: test mode enabled, a Stripe TEST key configured, and the
 * operator's MUSE_GENERIC_ADAPTER_CONFIG_JSON declaring this adapter
 * id for the ClutchAgent company. Returns a presence/reason result;
 * never throws for a gate failure and never logs a secret.
 */
export function registerStripeTestAdapter(args: {
  registry: ZeroTrustConnectorRegistry;
  env: NodeJS.ProcessEnv;
  adapterConfig: Record<string, string>;
  resolveOffers: () => Promise<NormalizedOffer[]>;
  fetchImpl?: StripeTestFetchFn;
}): {registered: boolean; reason?: string} {
  const config = resolveStripeTestConfig(args.env);
  if (!config.enabled) return {registered: false, reason: 'muse_stripe_test_disabled'};
  if (args.adapterConfig[CLUTCHAGENT_COMPANY_ID] !== STRIPE_TEST_ADAPTER_ID) {
    return {registered: false, reason: 'muse_stripe_test_adapter_not_configured'};
  }
  try {
    assertStripeTestKeyUsable(config);
  } catch (error) {
    return {registered: false, reason: error instanceof Error ? error.message : 'muse_stripe_test_key_invalid'};
  }
  const adapter = new StripeTestModeConnectorAdapter({
    secretKey: args.env.STRIPE_TEST_SECRET_KEY as string,
    enabled: true,
    resolveOffers: args.resolveOffers,
    fetchImpl: args.fetchImpl,
  });
  try {
    args.registry.register(clutchAgentStripeTestManifest, adapter);
  } catch (error) {
    return {registered: false, reason: error instanceof Error ? error.message : 'connector_registration_failed'};
  }
  return {registered: true};
}
