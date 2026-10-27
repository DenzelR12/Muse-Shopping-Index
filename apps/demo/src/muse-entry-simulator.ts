/**
 * DEMO SIMULATOR — NOT a native Meta button, NOT Meta distribution,
 * NOT a Meta callback, NOT a Muse app deep link, and NOT an
 * authentication boundary.
 *
 * Aim this simulates, in the demo only: pressing "Shop this reel" on
 * Meta opens a Muse window to complete the purchase — exact review →
 * one explicit approval → server execution.
 *
 * What the simulator does:
 *   - Takes a ReelCommerceIntent and a consumer batch and runs the
 *     existing demo bridge (buildReelDemoBridge). If details are
 *     missing it returns COLLECT_BATCH and opens NO review window,
 *     no draft, and no approval.
 *   - When the bridge is FINAL_REVIEW, it runs the existing
 *     bridge→draft handoff preflight (validateReelDemoBridgeDraftHandoff)
 *     so a demo label, a raw-ID seller/title, or a title mismatch
 *     fails fast here, exactly as it would before a real draft
 *     submission.
 *   - It then returns an exact-review preview shaped for the existing
 *     Muse confirmation rendering: resolved seller, resolved title,
 *     quantity, subtotal, currency, payment label exactly
 *     "Saved payment", full ship-to, terms/timing (or "not available"
 *     when not supplied — never an invented date), approvalRequired
 *     true, and approvalToken null.
 *
 * What the simulator does NOT do, by design:
 *   - It does NOT verify an HMAC signature. Its `signatureVerified`
 *     flag is a caller-supplied simulation input, not a verification.
 *     The real gate is server-side: POST /v1/muse/reel-entry calls
 *     validateReelEntry, which requires META_REEL_CALLBACK_SIGNING_SECRET
 *     (absent → 410) and a valid sha256= HMAC over the raw body
 *     (bad/missing signature → 401). Nothing in this simulator may be
 *     used as that gate, and an unsigned press must be rejected by
 *     the caller before it ever reaches a draft service.
 *   - It does NOT create or sign a server draft, issue approval, or
 *     execute a payment. Its draft field is always signed:false with
 *     next:'EXISTING_DRAFT_SERVICE': the authenticated company draft
 *     service must create the signed draft, POST /v1/muse/agent must
 *     start only from that owned signed draft, and the server must
 *     issue exact, consume-once approval bound to the draft hash
 *     before any execution.
 *   - It does NOT invent a Meta API, a deep-link scheme, or a Muse
 *     app URL. The live entry contract is docs/muse-entry-contract.md;
 *     Meta must still provide Reels distribution approval and a
 *     signed callback/deep-link contract before any of this is native.
 *   - It does NOT render the live confirmation page itself. In the
 *     live path the host renders museConfirmationSheet() from a
 *     server-supplied signed approval envelope; this preview is the
 *     demo-only view that the same rendering rules would show.
 */
import {
  buildReelDemoBridge,
  validateReelDemoBridgeDraftHandoff,
  type ReelDemoBridgeResult,
} from './reel-demo-bridge.js';
import type {ReelCommerceIntent} from './reel-commerce.js';
import type {CheckoutConsumerContext} from './checkout-plan.js';

export const MUSE_ENTRY_SIMULATOR_LABEL =
  'DEMO SIMULATOR — NOT a native Meta button, NOT Meta distribution, NOT a Meta callback';

const RAW_ID_PATTERN = /gid:\/\/|myshopify\.com|acct_/;

export interface MuseEntrySimulatorReview {
  seller: string;
  title: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  currency: string;
  paymentLabel: 'Saved payment';
  shipTo: string;
  terms: string;
  paymentTiming: string;
  approvalRequired: true;
  approvalToken: null;
}

export interface MuseEntrySimulatorResult {
  label: string;
  intentId: string;
  next: 'COLLECT_BATCH' | 'EXACT_REVIEW';
  /** True only in the demo sense: the preview window is shown. Never a Muse app window. */
  museWindowOpened: boolean;
  review: MuseEntrySimulatorReview | null;
  missing: ReelDemoBridgeResult['plan']['missing'];
  draft: ReelDemoBridgeResult['draft'];
  nextStep:
    | 'COLLECT_MISSING_DETAILS'
    | 'SUBMIT_DRAFT_AS_AUTHENTICATED_COMPANY_CALLER_THEN_AGENT';
  confirmationPage: {
    renderWith: 'museConfirmationSheet';
    requiresSignedEnvelope: true;
    note: string;
  };
}

function optionalReviewText(value: unknown, field: string): string {
  if (value === undefined || value === null) return 'not available';
  if (typeof value !== 'string') throw new Error(`muse_entry_simulator_${field}_invalid`);
  const trimmed = value.trim();
  if (!trimmed) return 'not available';
  if (trimmed.length > 1000) throw new Error(`muse_entry_simulator_${field}_invalid`);
  if (RAW_ID_PATTERN.test(trimmed)) throw new Error(`muse_entry_simulator_${field}_raw_id`);
  return trimmed;
}

export function formatSimulatorShipTo(
  address: CheckoutConsumerContext['shippingAddress'],
): string {
  if (!address) return 'not available';
  return [address.name, address.address1, address.address2, address.city, address.provinceCode, address.countryCode, address.zip]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(', ');
}

/**
 * Simulate a "Shop this reel" press. `signatureVerified` must be true:
 * it stands in for the server-side HMAC check in validateReelEntry and
 * is the ONLY way this function proceeds past the gate. A missing or
 * false value throws, mirroring the real 401 (bad signature) / 410
 * (no signing secret) rejection — without performing any verification
 * itself. Callers must never pass true for an unverified press.
 */
export function simulateShopThisReelPress(args: {
  intent: ReelCommerceIntent;
  selectedOfferId: string;
  quantity?: number;
  consumer?: CheckoutConsumerContext;
  /** Caller-supplied simulation input only — NOT an HMAC verification. */
  signatureVerified: boolean;
  /** Resolved, server-registered company display name. 'Demo Seller' is rejected by the preflight. */
  sellerDisplayName: string;
  terms?: string;
  paymentTiming?: string;
}): MuseEntrySimulatorResult {
  if (!args.signatureVerified) {
    throw new Error('muse_entry_simulator_signature_required');
  }
  const bridge = buildReelDemoBridge({
    intent: args.intent,
    selectedOfferId: args.selectedOfferId,
    quantity: args.quantity,
    consumer: args.consumer,
  });
  const confirmationPage = {
    renderWith: 'museConfirmationSheet' as const,
    requiresSignedEnvelope: true as const,
    note: 'Live rendering uses a server-supplied signed approval envelope, never this demo preview.',
  };
  if (bridge.next !== 'FINAL_REVIEW' || !bridge.review) {
    return {
      label: MUSE_ENTRY_SIMULATOR_LABEL,
      intentId: bridge.intentId,
      next: 'COLLECT_BATCH',
      museWindowOpened: false,
      review: null,
      missing: bridge.plan.missing,
      draft: bridge.draft,
      nextStep: 'COLLECT_MISSING_DETAILS',
      confirmationPage,
    };
  }
  const handoff = validateReelDemoBridgeDraftHandoff({
    bridge,
    sellerDisplayName: args.sellerDisplayName,
    expectedTitle: bridge.review.title,
  });
  const review: MuseEntrySimulatorReview = {
    seller: handoff.sellerDisplayName,
    title: handoff.title,
    quantity: bridge.review.quantity,
    unitPrice: bridge.review.unitPrice,
    subtotal: bridge.review.subtotal,
    currency: bridge.review.currency,
    paymentLabel: 'Saved payment',
    shipTo: formatSimulatorShipTo(bridge.plan.consumer.shippingAddress),
    terms: optionalReviewText(args.terms, 'terms'),
    paymentTiming: optionalReviewText(args.paymentTiming, 'payment_timing'),
    approvalRequired: true,
    approvalToken: null,
  };
  // No raw ID may reach the review, even if the offer carried one.
  for (const value of [review.seller, review.title, review.shipTo, review.terms, review.paymentTiming]) {
    if (RAW_ID_PATTERN.test(value)) throw new Error('muse_entry_simulator_raw_id_in_review');
  }
  return {
    label: MUSE_ENTRY_SIMULATOR_LABEL,
    intentId: bridge.intentId,
    next: 'EXACT_REVIEW',
    museWindowOpened: true,
    review,
    missing: [],
    draft: bridge.draft,
    nextStep: 'SUBMIT_DRAFT_AS_AUTHENTICATED_COMPANY_CALLER_THEN_AGENT',
    confirmationPage,
  };
}
