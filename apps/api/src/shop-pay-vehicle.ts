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
