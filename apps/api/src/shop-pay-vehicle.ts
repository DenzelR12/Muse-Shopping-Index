// Shop Pay as an ADDITIONAL payment vehicle alongside Stripe saved
// authorization — not a replacement, and not a relabel of Stripe.
//
// What exists today (verified by searching services/payments,
// apps/api, apps/storefront and docs before this step):
//   - Shop identity is the consumer enrollment anchor (Shop OIDC /
//     shopUserPublicId in consumer-commerce-identity.ts).
//   - Stripe saved authorization (off_session) is the working payment
//     rail: services/payments/src/stripe.ts is the only payment API
//     client in the repo.
//   - Consumer identity already carries a 'shop_pay' rail label
//     (ConsumerPaymentRail), but there is no Shop Pay API client, no
//     authorized Shop Pay credentials, and no Shop Pay checkout
//     endpoint anywhere in code. That is why execution below is a
//     blocked stub, not a call.
//
// What this module adds:
//   - A paymentVehicle field ('stripe' | 'shop_pay', default 'stripe'
//     for existing/legacy drafts) carried on the draft state and the
//     approval envelope, validated to agree with payment.provider
//     whenever both are present. A mismatch is invalid state, never
//     silently coerced to Stripe.
//   - A consumer-facing label rule: exactly 'Saved payment' for
//     Stripe, and 'Shop Pay · Saved payment' ONLY when the vehicle is
//     actually shop_pay. Raw provider/account IDs are never a label.
//   - A readiness gate: a Shop Pay vehicle is ready only when the
//     company is transaction-ready under the Step 2 rules
//     (TRANSACTION_READY or AUTONOMOUS_READY — the Meta-origin ladder
//     still applies, and an omitted/unknown origin still fails closed
//     to the Meta path in providerReadiness.evaluate) AND the
//     server-supplied Shop Pay vehicle flag is true. The gate is
//     evaluated from caller-supplied, server-owned inputs only.
//   - A blocked execution stub. executeShopPaySavedAuthorization()
//     always throws 'shop_pay_execution_blocked' BEFORE any intent,
//     payment, or approval-consumption commit. Live Shop Pay execution
//     remains blocked until authorized Shop Pay credentials and a real
//     Shop Pay checkout client are added; no API call, fake
//     credential, or fake success path is invented here.

export type PaymentVehicle = 'stripe' | 'shop_pay';

export const SHOP_PAY_EXECUTION_BLOCKED = 'shop_pay_execution_blocked';

export function normalizePaymentVehicle(value: unknown): PaymentVehicle {
  if (value === undefined) return 'stripe';
  if (value === 'stripe' || value === 'shop_pay') return value;
  throw new Error('provider_transaction_payment_vehicle_invalid');
}

/** Resolve the vehicle from the two places it can appear, failing
 *  closed on disagreement instead of picking one silently. Legacy
 *  drafts carry neither field and resolve to 'stripe'. */
export function resolvePaymentVehicle(args: {
  paymentProvider?: unknown;
  paymentVehicle?: unknown;
}): PaymentVehicle {
  const provider =
    args.paymentProvider === undefined
      ? undefined
      : normalizePaymentVehicle(args.paymentProvider);
  const vehicle =
    args.paymentVehicle === undefined
      ? undefined
      : normalizePaymentVehicle(args.paymentVehicle);
  if (provider !== undefined && vehicle !== undefined && provider !== vehicle) {
    throw new Error('provider_transaction_payment_vehicle_mismatch');
  }
  return vehicle ?? provider ?? 'stripe';
}

export function paymentLabelForVehicle(
  vehicle: PaymentVehicle
): 'Saved payment' | 'Shop Pay · Saved payment' {
  return vehicle === 'shop_pay' ? 'Shop Pay · Saved payment' : 'Saved payment';
}

export interface ShopPayVehicleReadiness {
  /** Company readiness stage under the Step 2 ladder. Only
   *  TRANSACTION_READY / AUTONOMOUS_READY pass; anything else —
   *  including CONNECTED for a Meta-origin business without validated
   *  Meta verification evidence — blocks. */
  businessReadiness: string;
  /** Server-supplied Shop Pay vehicle flag for this company (e.g. the
   *  company has Shop Pay enabled). Never read from model output,
   *  browser JSON, or a consumer-supplied field. */
  shopPayVehicleReady: boolean;
}

export function isShopPayVehicleReady(input: ShopPayVehicleReadiness): boolean {
  return (
    (input.businessReadiness === 'TRANSACTION_READY' ||
      input.businessReadiness === 'AUTONOMOUS_READY') &&
    input.shopPayVehicleReady === true
  );
}

export function assertShopPayVehicleReady(input: ShopPayVehicleReadiness): void {
  if (!isShopPayVehicleReady(input)) {
    throw new Error('shop_pay_vehicle_not_ready');
  }
}

/** Blocked execution stub. There is no Shop Pay API client, no
 *  authorized Shop Pay credentials, and no Shop Pay checkout endpoint
 *  in this codebase, so this is the only Shop Pay execution path and
 *  it never commits anything: no intent is created, no payment is
 *  attempted, and the caller must not consume a one-time approval
 *  before calling it (see muse-confirmation-submit.ts, which throws
 *  this before delegating to the execution service, so a blocked
 *  attempt does not burn the approval). A future live implementation
 *  must replace this stub with a real authorized client and keep the
 *  exact approval binding, consume-once JTI, drift revalidation, and
 *  reconciliation-on-uncertainty behaviour of the Stripe path. */
export function executeShopPaySavedAuthorization(): never {
  throw new Error(SHOP_PAY_EXECUTION_BLOCKED);
}

/**
 * Credential-gated Shop Pay execution (live-activation point).
 *
 * The operator's authorized Shop Pay checkout client is an
 * interface, deliberately NOT a guessed Shop Pay API endpoint:
 * no Shop Pay API shape exists in this repo, and inventing one
 * would be a fake success path. At activation the operator
 * supplies, via secret manager + startup registration only:
 *  - SHOP_PAY_EXECUTION_ENABLED=true
 *  - SHOP_PAY_API_KEY (presence only; the value is never logged
 *    or read back here)
 *  - SHOP_PAY_CHECKOUT_CLIENT (identifier of the operator's
 *    startup-registered client)
 * plus a client registered at server startup (see
 * live-activation.ts). Without all three, or without a client,
 * execution fails closed with shop_pay_execution_blocked (config
 * missing) or shop_pay_execution_client_not_registered (config
 * present, no client), and the caller must not consume the
 * approval. With a client, the client executes and the caller
 * consumes the approval exactly once on success; a client throw
 * consumes nothing and must be reconciled, never blindly retried.
 */
export interface ShopPayExecutionClient {
  execute(args: {
    companyId: string;
    draftId: string;
    total: number;
    currency: string;
    authorizationReference: string;
  }): Promise<{providerReference: string; executionId?: string}>;
}

export interface ShopPayExecutionConfig {
  enabled: boolean;
  credentialConfigured: boolean;
  clientConfigured: boolean;
  ready: boolean;
}

export function resolveShopPayExecutionConfig(
  env: NodeJS.ProcessEnv
): ShopPayExecutionConfig {
  const enabled = env.SHOP_PAY_EXECUTION_ENABLED === 'true';
  const credentialConfigured = Boolean(env.SHOP_PAY_API_KEY?.trim());
  const clientConfigured = Boolean(env.SHOP_PAY_CHECKOUT_CLIENT?.trim());
  return {
    enabled,
    credentialConfigured,
    clientConfigured,
    ready: enabled && credentialConfigured && clientConfigured,
  };
}

export async function executeShopPayWithClient(args: {
  client: ShopPayExecutionClient | null;
  config: ShopPayExecutionConfig;
  execution: {
    companyId: string;
    draftId: string;
    total: number;
    currency: string;
    authorizationReference: string;
  };
}): Promise<{providerReference: string; executionId?: string}> {
  if (!args.config.ready) throw new Error(SHOP_PAY_EXECUTION_BLOCKED);
  if (!args.client) throw new Error('shop_pay_execution_client_not_registered');
  return args.client.execute(args.execution);
}
