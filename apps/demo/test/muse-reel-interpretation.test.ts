import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENRG_REEL_OBSERVATION,
  ENRG_TEE_CATALOG_TEST,
  interpretEnrgReel,
  interpretMuseReel,
} from '../src/muse-reel-interpretation.js';

const NOW = '2026-10-27T12:00:00.000Z';
const FRESH = '2026-10-27T10:00:00.000Z';

test('(a) ENRG Reel match: Reel apparel + $44 catalog price -> exact review draft facts, approval still required, nothing executed', () => {
  const result = interpretEnrgReel({
    catalog: { ...ENRG_TEE_CATALOG_TEST, updatedAt: FRESH },
    now: NOW,
  });
  assert.equal(result.status, 'eligible_for_exact_review');
  if (result.status === 'eligible_for_exact_review') {
    assert.equal(result.title, 'ENRG Unisex Oversized T-Shirt');
    assert.equal(result.priceAmount, 44);
    assert.equal(result.currency, 'USD');
    assert.ok(result.matchedTerms.includes('enrg'));
    assert.equal(result.approvalRequired, true);
    assert.equal(result.executed, false);
    // Labelling limit: terms match the catalog title; the exact SKU
    // is NOT independently verified by this harness.
    assert.equal(result.skuMatchVerified, false);
  }
  assert.equal(ENRG_REEL_OBSERVATION.reelId, 'Deo7I3cR7Wq');
});

test('(b) mismatch rejected: caption $199 vs catalog $249 -> drift, catalog wins, no draft signed, no approval consumed', () => {
  const result = interpretMuseReel({
    observation: {
      reelId: 'Deo7I3cR7Wq',
      imageDescription: 'person wearing dark ENRG apparel',
      caption: 'ENRG tee only $199 today!',
    },
    catalog: {
      title: 'ENRG Unisex Oversized T-Shirt',
      priceAmount: 249,
      currency: 'USD',
      available: true,
      updatedAt: FRESH,
    },
    now: NOW,
  });
  assert.equal(result.status, 'drift_reapproval_required');
  if (result.status === 'drift_reapproval_required') {
    assert.equal(result.reason, 'caption_price_mismatch');
    assert.equal(result.catalogPriceAmount, 249);
    assert.equal(result.claimedPriceAmount, 199);
    assert.equal(result.draftSigned, false);
    assert.equal(result.approvalConsumed, false);
  }
});

test('(b2) ENRG mismatch: caption $199 vs the $44 catalog price is also drift, with $44 as the catalog price', () => {
  const result = interpretMuseReel({
    observation: {
      reelId: 'Deo7I3cR7Wq',
      imageDescription: 'person wearing dark ENRG apparel',
      caption: 'ENRG tee only $199 today!',
    },
    catalog: { ...ENRG_TEE_CATALOG_TEST, updatedAt: FRESH },
    now: NOW,
  });
  assert.equal(result.status, 'drift_reapproval_required');
  if (result.status === 'drift_reapproval_required') {
    assert.equal(result.catalogPriceAmount, 44);
    assert.equal(result.claimedPriceAmount, 199);
  }
});

test('(c) no catalog -> unverifiable, fail closed, no draft, no approval consumed', () => {
  const result = interpretEnrgReel({ catalog: null, now: NOW });
  assert.deepEqual(result, {
    status: 'unverifiable',
    reelId: 'Deo7I3cR7Wq',
    reason: 'no_catalog_match',
    draftSigned: false,
    approvalConsumed: false,
  });
});

test('stale catalog and raw IDs: stale is unverifiable, and raw IDs never reach the result', () => {
  const stale = interpretEnrgReel({
    catalog: { ...ENRG_TEE_CATALOG_TEST, updatedAt: '2026-10-20T10:00:00.000Z' },
    now: NOW,
  });
  assert.equal(stale.status, 'unverifiable');
  const hostile = interpretMuseReel({
    observation: {
      reelId: 'Deo7I3cR7Wq',
      imageDescription: 'person wearing dark ENRG apparel gid://shopify/Product/123 test-store.myshopify.com acct_456',
    },
    catalog: { ...ENRG_TEE_CATALOG_TEST, updatedAt: FRESH },
    now: NOW,
  });
  assert.ok(!JSON.stringify(hostile).includes('gid://'));
  assert.ok(!JSON.stringify(hostile).includes('myshopify.com'));
  assert.ok(!JSON.stringify(hostile).includes('acct_'));
});
