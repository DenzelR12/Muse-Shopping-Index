/**
 * DEMONSTRATION HARNESS — NOT native Meta/Reels entry, NOT account linking,
 * NOT a trusted confirmation callback, and NOT a live Shop integration.
 *
 * Shop this reel, fewer clicks, as a demo flow:
 *   Reel intent -> one batch of missing details -> one exact review
 *   -> one explicit human approval -> server execution
 *   -> Shop backend notifications / verification / email / shipping,
 *      where the merchant is authorized on Shop.
 *
 * What this harness does:
 *   - Takes a ReelCommerceIntent (see reel-commerce.ts) and a single batch of
 *     consumer details (see checkout-plan.ts).
 *   - Selects one offer from the intent results and builds a MuseCheckoutPlan.
 *   - If details are missing, returns COLLECT_BATCH with the full missing list
 *     in one batch — it does not drip questions and does not proceed to review.
 *   - If the plan is ready, returns an exact review preview (title, quantity,
 *     subtotal, currency, fulfillment mode, payment label "Saved payment").
 *
 * What this harness does NOT do, by design:
 *   - It does NOT create or sign a server draft. The existing server draft
 *     service must create the signed draft; this harness only prepares the
 *     plan and review that draft service consumes.
 *   - It does NOT issue approval, and it returns approvalToken: null.
 *     Exact approval must be issued server-side, bound to the exact draft
 *     hash, total, currency, and payment authorization, and consumed once.
 *   - It does NOT revalidate live provider state, execute a payment, or claim
 *     live Shop notifications, verification, email, or shipping. Shop backend
 *     handling applies only where the merchant is authorized on Shop; in this
 *     demo it is the intended backend story, not a verified live effect.
 *   - It does NOT bypass live-drift revalidation: any changed price, tax,
 *     shipping, configuration, terms, or payment authorization in the real
 *     draft flow requires fresh approval before execution.
 */
import type {ReelCommerceIntent} from './reel-commerce.js';
import {buildMuseCheckoutPlan,type CheckoutConsumerContext,type MuseCheckoutPlan} from './checkout-plan.js';

export const REEL_DEMO_BRIDGE_LABEL =
  'demonstration harness, not native Meta/Reels entry, not account linking, not a trusted confirmation callback';

export interface ReelDemoBridgeReview {
  seller:string;
  title:string;
  offerId:string;
  companyId:string;
  quantity:number;
  unitPrice:number;
  subtotal:number;
  currency:string;
  fulfillmentMode?:string;
  paymentLabel:'Saved payment';
  approvalRequired:true;
  approvalToken:null;
  shopBackendNote:string;
}

export interface ReelDemoBridgeResult {
  label:string;
  intentId:string;
  plan:MuseCheckoutPlan;
  next:'COLLECT_BATCH'|'FINAL_REVIEW';
  review:ReelDemoBridgeReview|null;
  draft:{
    signed:false;
    draftId:null;
    draftHash:null;
    expiresAt:null;
    next:'EXISTING_DRAFT_SERVICE';
    note:string;
  };
  steps:string[];
}

const SHOP_BACKEND_NOTE =
  'Shop backend handling — notifications, verification, email, and shipping — ' +
  'applies only where the merchant is authorized on Shop. This demonstration ' +
  'does not claim live Shop integration, live payment, or live shipping.';

const RAW_ID_PATTERN = /gid:\/\/|myshopify\.com|acct_/;

/**
 * Bottleneck fix: the bridge → signed-draft step was a manual presenter
 * mapping (docs/demo-walkthrough.md Step 1 → Step 2), so a demo seller
 * name, a title mismatch, or a raw ID was only caught later by draft
 * validation or by a fail-closed review. This pure preflight validates
 * the handoff BEFORE an authenticated company caller submits a draft.
 * It creates nothing, signs nothing, issues no approval, and does not
 * substitute for server-side draft validation: the draft service must
 * still validate sellerDisplayName, itemTitles, terms, timing, and
 * arrival itself. It only fails fast, with a named next action, on
 * the mismatches a presenter can fix before submitting.
 *
 * sellerDisplayName must be the company's real, server-registered name:
 * the bridge's 'Demo Seller' is a demo label and is rejected here, as
 * is any name containing a raw-ID pattern or equal to the companyId
 * (a raw account/domain fallback in disguise).
 * expectedTitle, when supplied, must equal the bridge review title:
 * a draft whose item title differs from the reviewed title would
 * require reapproval anyway, so catching it here saves a round-trip.
 */
export function validateReelDemoBridgeDraftHandoff(args: {
  bridge: ReelDemoBridgeResult;
  sellerDisplayName: unknown;
  expectedTitle?: unknown;
}): {
  ready: true;
  next: 'SUBMIT_DRAFT_AS_AUTHENTICATED_COMPANY_CALLER';
  sellerDisplayName: string;
  title: string;
} {
  const {bridge} = args;
  if (!bridge || bridge.next !== 'FINAL_REVIEW' || !bridge.review) {
    throw new Error('reel_demo_handoff_not_final_review');
  }
  const sellerDisplayName =
    typeof args.sellerDisplayName === 'string' ? args.sellerDisplayName.trim() : '';
  if (!sellerDisplayName) throw new Error('reel_demo_handoff_seller_display_required');
  if (sellerDisplayName === 'Demo Seller') {
    throw new Error('reel_demo_handoff_demo_seller_not_a_display_name');
  }
  if (RAW_ID_PATTERN.test(sellerDisplayName)) {
    throw new Error('reel_demo_handoff_raw_id_display_name');
  }
  if (bridge.review.companyId && sellerDisplayName === bridge.review.companyId) {
    throw new Error('reel_demo_handoff_raw_id_display_name');
  }
  if (args.expectedTitle !== undefined) {
    if (typeof args.expectedTitle !== 'string' || args.expectedTitle.trim() !== bridge.review.title) {
      throw new Error('reel_demo_handoff_title_mismatch');
    }
  }
  if (RAW_ID_PATTERN.test(bridge.review.title)) {
    throw new Error('reel_demo_handoff_raw_id_title');
  }
  return {
    ready: true,
    next: 'SUBMIT_DRAFT_AS_AUTHENTICATED_COMPANY_CALLER',
    sellerDisplayName,
    title: bridge.review.title,
  };
}

export function buildReelDemoBridge(args:{
  intent:ReelCommerceIntent;
  selectedOfferId:string;
  quantity?:number;
  consumer?:CheckoutConsumerContext;
}):ReelDemoBridgeResult{
  const {intent,selectedOfferId}=args;
  if(!intent||intent.next!=='MUSE_REVIEW') throw new Error('reel_demo_intent_not_ready_for_review');
  if(!Array.isArray(intent.results)||intent.results.length<1) throw new Error('reel_demo_no_offers');
  const selected=intent.results.find(result=>result.offer.offerId===selectedOfferId);
  if(!selected) throw new Error('reel_demo_offer_not_in_intent');
  const offer=selected.offer;
  if(offer.availability!=='AVAILABLE'&&offer.availability!=='LIMITED') throw new Error('reel_demo_offer_not_actionable');
  if(!offer.title?.trim()||!Number.isFinite(offer.price)||offer.price<0||!/^[A-Z]{3}$/.test(offer.currency)){
    throw new Error('reel_demo_offer_invalid');
  }
  const plan=buildMuseCheckoutPlan({intentId:intent.intentId,offer,quantity:args.quantity,consumer:args.consumer});
  const steps=[
    'intent',
    'one_batch_details',
    'exact_review',
    'one_approval',
    'server_execution',
    'shop_backend_where_authorized',
    'owned_status'
  ];
  // Typed as the result draft, not `as const`: `null as const` is not a
  // valid const assertion (TS1355), and the annotation already pins the
  // literal types (signed:false, null draft fields, fixed next value).
  const draft: ReelDemoBridgeResult['draft']={
    signed:false,
    draftId:null,
    draftHash:null,
    expiresAt:null,
    next:'EXISTING_DRAFT_SERVICE',
    note:'This harness does not create or sign a server draft and does not issue approval. ' +
      'The existing server draft service must create the signed draft, and the server must issue ' +
      'exact, consume-once approval before any execution.'
  };
  if(!plan.readyForApproval||plan.missing.length){
    return {label:REEL_DEMO_BRIDGE_LABEL,intentId:intent.intentId,plan,next:'COLLECT_BATCH',review:null,draft,steps};
  }
  if(!plan.quantity||plan.subtotal===undefined) throw new Error('reel_demo_plan_incomplete');
  return {
    label:REEL_DEMO_BRIDGE_LABEL,
    intentId:intent.intentId,
    plan,
    next:'FINAL_REVIEW',
    review:{
      seller:'Demo Seller',
      title:offer.title,
      offerId:offer.offerId,
      companyId:offer.companyId,
      quantity:plan.quantity,
      unitPrice:offer.price,
      subtotal:plan.subtotal,
      currency:offer.currency,
      ...(offer.fulfillmentMode?{fulfillmentMode:offer.fulfillmentMode}:{}),
      paymentLabel:'Saved payment',
      approvalRequired:true,
      approvalToken:null,
      shopBackendNote:SHOP_BACKEND_NOTE
    },
    draft,
    steps
  };
}
