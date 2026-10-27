/**
 * Multi-company demo scenario — TEST ONLY, NOT LIVE, NOT REAL.
 *
 * Muse Shopping Index is a Muse FEATURE, never a storefront, cart page,
 * or checkout page. This module is a pure demo scenario: it makes no
 * network call, moves no real money, creates no real order, and talks
 * to no live seller, catalog, payment provider, Shopify store, or
 * Meta service.
 *
 * CORRECTED TENANT MAPPING (user correction, overrides any earlier
 * ClutchAgent-as-seller mapping):
 * - Company 1 = THEENRG.COM (test), the Shopify tenant. Shopify
 *   Storefront read-only path, physical TEST product, shipped.
 *   THEENRG.COM is named only as the Shopify-side tenant label.
 *   NO real THEENRG.COM store details, real products, real prices,
 *   or token are invented here: the product below is a generic
 *   TEST product with TEST prices, and no token exists in this
 *   module. The real store domain, product, and Storefront token
 *   must be supplied and verified by the owner before any live read.
 * - Company 2 = ClutchAgent (test), the Muse Meta tenant/context.
 *   Meta catalog read-only path, Reel entry, Muse panel. ClutchAgent
 *   is NOT a Shopify seller and NOT a service checkout product.
 *   Its item below is a generic TEST product reached via the Meta
 *   read-only path. ClutchAgent brand facts are context only —
 *   "AI Operating System for Athletes", recruiting / NIL /
 *   performance, ClutchAgent Inc, www.clutchagent.app — and no
 *   ClutchAgent service price, term, or entitlement is created here.
 *
 * WHAT IT SHOWS, IN ORDER:
 * - Company 1 (THEENRG.COM, Shopify) flows Reel -> exact review ->
 *   approval -> status.
 * - Company 2 (ClutchAgent, Meta) flows Reel entry -> exact review ->
 *   approval -> status.
 * - Company 1 then drifts and requires reapproval; Company 2 is
 *   unaffected, proving tenant isolation across two different
 *   provider paths (Shopify Storefront vs Meta catalog).
 * - Per-company BI at the end is tenant-trimmed and verified-only,
 *   with exactly one outcome per draft.
 *
 * SAFETY PROPERTIES (never weakened, even in a demo):
 * - No model, caption, Reel text, or browser field grants approval,
 *   signs a draft, or supplies a title or price. Every price below is
 *   a hard-coded TEST fixture, and every approval follows an exact
 *   review of those exact terms.
 * - One approval is bound to one set of exact terms and is
 *   consume-once. Any price, tax, shipping, or terms change makes the
 *   old approval gone and requires a fresh exact review and a fresh
 *   approval (see the Company 1 drift step).
 * - Uncertainty would go to reconciliation, never to a blind retry.
 *   This scenario contains no uncertain step and no retry.
 * - No raw IDs appear anywhere: "draft 1" and "draft 2" are plain
 *   test labels, not identifiers from any system. No tokens, no
 *   secrets, no account numbers.
 * - Payment labels carry no digits: exactly "Shop Pay · Saved payment"
 *   for Company 1 (Shopify) and exactly "Saved payment" for
 *   Company 2 (Meta).
 * - No order numbers are issued by this demo, and no real order exists.
 *
 * TEST FIXTURES AND ARITHMETIC (all amounts in USD, TEST only):
 * - Company 1 — THEENRG.COM (test), Shopify, PHYSICAL TEST product
 *   (shipped, so shipping applies):
 *     Item $58 + Tax $5 + Shipping $9 = Total $72.
 *     Check: 58 + 5 + 9 = 72.
 * - Company 1 drift (new terms, old approval gone):
 *     Item $64 + Tax $5 (unchanged) + Shipping $9 (unchanged)
 *       = New total $78.
 *     Check: 64 + 5 + 9 = 78. Old total was $72; the change is
 *     $78 - $72 = $6, entirely from the $58 -> $64 item change.
 * - Company 2 — ClutchAgent (test), Meta, generic TEST product via
 *   the Meta read-only path (NOT a ClutchAgent service product):
 *     Item $40 + Tax $3 + Shipping $6 = Total $49.
 *     Check: 40 + 3 + 6 = 49.
 *
 * TEST TIMESTAMPS: the only timestamp in the output is the fixed
 * ISO test timestamp 2026-10-27T12:00:00.000Z. It is a TEST
 * timestamp chosen for this fixture; it is not a real event time
 * and no other date appears in the output.
 */

export interface MultiCompanyDemoStep {
  tenant: string;
  step: string;
  outcome: string;
}

export const TEST_TIMESTAMP = '2026-10-27T12:00:00.000Z';

export const COMPANY_1_TENANT = 'Company 1 — THEENRG.COM (test, Shopify)';
export const COMPANY_2_TENANT = 'Company 2 — ClutchAgent (test, Muse Meta)';

export function runMultiCompanyDemo(): MultiCompanyDemoStep[] {
  return [
    {
      tenant: COMPANY_1_TENANT,
      step: 'reel',
      outcome:
        'Reel pressed for Company 1 (THEENRG.COM, test, Shopify ' +
        'tenant): a physical test product, shipped, via the ' +
        'Shopify Storefront read-only path. The Reel itself ' +
        'supplies no title, price, or terms; those come only ' +
        'from the exact review that follows. No real store ' +
        'product, price, or token is used here.',
    },
    {
      tenant: COMPANY_1_TENANT,
      step: 'exact_review',
      outcome:
        'Exact review for Company 1 (THEENRG.COM, test, Shopify), ' +
        'physical test product, shipped: Item $58 + Tax $5 + ' +
        'Shipping $9 = Total $72. Payment: Shop Pay · Saved ' +
        'payment. Terms: test product only. Nothing here is ' +
        'approved yet.',
    },
    {
      tenant: COMPANY_1_TENANT,
      step: 'approval',
      outcome:
        'Approval granted for Company 1 on the exact terms above ' +
        'only: Item $58 + Tax $5 + Shipping $9 = Total $72, ' +
        'payment Shop Pay · Saved payment, shipped test product. ' +
        'This approval is bound to those exact terms and is ' +
        'consume-once; it cannot be reused for different terms.',
    },
    {
      tenant: COMPANY_1_TENANT,
      step: 'status',
      outcome:
        'Status for Company 1 (THEENRG.COM, test, Shopify): ' +
        'processing (TEST timestamp: 2026-10-27T12:00:00.000Z). ' +
        'No order number is issued by this demo, and no real ' +
        'order exists. Tracking is not available yet in this demo.',
    },
    {
      tenant: COMPANY_2_TENANT,
      step: 'reel_entry',
      outcome:
        'Reel entry for Company 2 (ClutchAgent, test, Muse Meta ' +
        'context): a generic test product via the Meta catalog ' +
        'read-only path, shown in a Muse panel. ClutchAgent is ' +
        'the Muse Meta context here, not a Shopify seller and ' +
        'not a service checkout product, and no ClutchAgent ' +
        'service price, term, or entitlement is created. The ' +
        'Reel entry itself supplies no title, price, or terms; ' +
        'those come only from the exact review that follows.',
    },
    {
      tenant: COMPANY_2_TENANT,
      step: 'exact_review',
      outcome:
        'Exact review for Company 2 (ClutchAgent, test, Muse ' +
        'Meta), generic test product via the Meta read-only ' +
        'path: Item $40 + Tax $3 + Shipping $6 = Total $49. ' +
        'Payment: Saved payment. Terms: test product only. ' +
        'Nothing here is approved yet.',
    },
    {
      tenant: COMPANY_2_TENANT,
      step: 'approval',
      outcome:
        'Approval granted for Company 2 on the exact terms above ' +
        'only: Item $40 + Tax $3 + Shipping $6 = Total $49, ' +
        'payment Saved payment, test product only. This approval ' +
        'is bound to those exact terms and is consume-once; it ' +
        'cannot be reused for different terms.',
    },
    {
      tenant: COMPANY_2_TENANT,
      step: 'status',
      outcome:
        'Status for Company 2 (ClutchAgent, test, Muse Meta): ' +
        'processing (TEST timestamp: 2026-10-27T12:00:00.000Z). ' +
        'No order number is issued by this demo, and no real ' +
        'order exists. Tracking is not available yet in this demo.',
    },
    {
      tenant: COMPANY_1_TENANT,
      step: 'drift',
      outcome:
        'reapproval_required for Company 1: the terms changed ' +
        'after approval. Item changed from $58 to $64; tax ' +
        'unchanged at $5; shipping unchanged at $9; total ' +
        'changed from $72 to $78. The old approval is gone; it ' +
        'cannot be reused for the new terms. A fresh exact ' +
        'review and a fresh approval are required before any ' +
        'further step, and no step is retried automatically.',
    },
    {
      tenant: COMPANY_2_TENANT,
      step: 'unaffected',
      outcome:
        'Company 2 is unaffected by Company 1 drift: Company 2 ' +
        'review, approval, and status are unchanged. Company 2 ' +
        'still stands at Item $40 + Tax $3 + Shipping $6 = ' +
        'Total $49, payment Saved payment, test product only. ' +
        'No Company 1 terms appear in Company 2 state, and ' +
        'Company 2 needs no new approval.',
    },
    {
      tenant: COMPANY_1_TENANT,
      step: 'bi',
      outcome:
        'Tenant-trimmed BI (verified only) for Company 1 only: ' +
        '1 verified outcome for draft 1 — approved at $72 ' +
        'before drift. The drift outcome (reapproval_required) ' +
        'is not a second outcome for draft 1, so draft 1 is ' +
        'counted exactly once. No Company 2 outcomes are ' +
        'included in Company 1 BI.',
    },
    {
      tenant: COMPANY_2_TENANT,
      step: 'bi',
      outcome:
        'Tenant-trimmed BI (verified only) for Company 2 only: ' +
        '1 verified outcome for draft 2 — approved, total $49. ' +
        'No Company 1 outcomes are included in Company 2 BI, ' +
        'and draft 2 is counted exactly once.',
    },
  ];
}
