import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateShopThisReelPress, MUSE_ENTRY_SIMULATOR_LABEL} from '../src/muse-entry-simulator.js';

const offer = {
  offerId: 'atlas-carry-on-22',
  companyId: 'atlas-retail',
  entityId: 'carry-on-22',
  kind: 'PRODUCT',
  title: 'Atlas Carry-On 22',
  price: 289,
  currency: 'USD',
  availability: 'AVAILABLE',
  fulfillmentMode: 'SHIP',
  attributes: {},
  intents: ['travel'],
  actions: ['BUY'],
  evidence: [{sourceId: 'x', observedAt: '2026-10-24T15:00:00Z', sourceType: 'CATALOG', fields: ['price']}],
} as any;

const intent = {
  intentId: 'intent-1',
  source: {platform: 'meta', reelId: 'reel-1', caption: 'Atlas Carry-On 22'},
  message: 'Atlas Carry-On 22',
  interpretation: {intent: {query: 'Atlas Carry-On 22'}},
  results: [{offer, score: 90, reasons: ['intent terms matched']}],
  next: 'MUSE_REVIEW',
  merchantHandoffRequired: false,
} as any;

const consumer = {
  subjectId: 'consumer-1',
  shopUserPublicId: 'shop-user-1',
  shopIdentityVerifiedAt: '2026-10-25T19:00:00Z',
  paymentAuthorization: {rail: 'stripe', reference: 'pi_verified_1', verifiedAt: '2026-10-25T19:00:05Z'},
  shippingAddress: {name: 'Buyer', address1: '123 Main St', city: 'Atlanta', provinceCode: 'GA', countryCode: 'US', zip: '30303'},
  confirmationEmail: 'buyer@example.com',
} as any;

const base = {
  intent, selectedOfferId: 'atlas-carry-on-22', quantity: 1, consumer,
  signatureVerified: true, sellerDisplayName: 'Atlas Travel Co',
  terms: 'Test terms only.', paymentTiming: 'At approval (test only).',
} as const;

test('simulator opens the exact review only on a verified-signature press, with no draft and no approval', () => {
  const result = simulateShopThisReelPress(base);
  assert.equal(result.label, MUSE_ENTRY_SIMULATOR_LABEL);
  assert.match(result.label, /NOT a native Meta button/);
  assert.equal(result.next, 'EXACT_REVIEW');
  assert.equal(result.museWindowOpened, true);
  assert.equal(result.review?.seller, 'Atlas Travel Co');
  assert.equal(result.review?.title, 'Atlas Carry-On 22');
  assert.equal(result.review?.quantity, 1);
  assert.equal(result.review?.subtotal, 289);
  assert.equal(result.review?.currency, 'USD');
  assert.equal(result.review?.paymentLabel, 'Saved payment');
  assert.equal(result.review?.shipTo, 'Buyer, 123 Main St, Atlanta, GA, US, 30303');
  assert.equal(result.review?.terms, 'Test terms only.');
  assert.equal(result.review?.paymentTiming, 'At approval (test only).');
  assert.equal(result.review?.approvalRequired, true);
  assert.equal(result.review?.approvalToken, null);
  assert.equal(result.draft.signed, false);
  assert.equal(result.draft.draftId, null);
  assert.equal(result.confirmationPage.requiresSignedEnvelope, true);
  for (const value of Object.values(result.review ?? {})) {
    assert.doesNotMatch(String(value), /gid:\/\/|myshopify\.com|acct_/);
  }
});

test('simulator rejects an unsigned or missing-signature press', () => {
  assert.throws(() => simulateShopThisReelPress({...base, signatureVerified: false}), /muse_entry_simulator_signature_required/);
});

test('simulator opens no window and creates no draft or approval when details are missing', () => {
  const result = simulateShopThisReelPress({...base, consumer: undefined});
  assert.equal(result.next, 'COLLECT_BATCH');
  assert.equal(result.museWindowOpened, false);
  assert.equal(result.review, null);
  assert.equal(result.draft.signed, false);
  assert.equal(result.draft.draftId, null);
  assert.deepEqual(result.missing, ['shop_identity', 'payment_authorization', 'shipping_address', 'confirmation_email']);
});

test('simulator rejects a demo-label seller, a raw-ID seller, and a raw-ID title', () => {
  assert.throws(() => simulateShopThisReelPress({...base, sellerDisplayName: 'Demo Seller'}), /demo_seller_not_a_display_name/);
  assert.throws(() => simulateShopThisReelPress({...base, sellerDisplayName: 'gid://shopify/Shop/1'}), /raw_id_display_name/);
  assert.throws(() => simulateShopThisReelPress({...base, sellerDisplayName: 'atlas-retail'}), /raw_id_display_name/);
  const rawTitleIntent = {...intent, results: [{offer: {...offer, title: 'gid://shopify/ProductVariant/9'}, score: 90, reasons: []}]} as any;
  assert.throws(() => simulateShopThisReelPress({...base, intent: rawTitleIntent}), /raw_id_title/);
});

test('simulator falls back to not available for terms and timing, never an invented value', () => {
  const result = simulateShopThisReelPress({...base, terms: undefined, paymentTiming: undefined});
  assert.equal(result.review?.terms, 'not available');
  assert.equal(result.review?.paymentTiming, 'not available');
});
