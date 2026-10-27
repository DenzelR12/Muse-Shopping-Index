import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMultimodalIntentCandidate,
  stripRawIdsFromText,
  verifyMultimodalIntentAgainstCatalog,
  type MuseCatalogRecordForIntent,
} from '../src/muse-multimodal-intent.js';

const NOW = '2026-10-27T12:00:00.000Z';
const FRESH = '2026-10-27T10:00:00.000Z';

const aurora: MuseCatalogRecordForIntent = {
  title: 'Aurora Wireless Noise-Cancelling Headphones',
  priceAmount: 249,
  currency: 'USD',
  available: true,
  updatedAt: FRESH,
};

test('multimodal candidate that matches the catalog is eligible, with facts from the catalog only', () => {
  const candidate = buildMultimodalIntentCandidate({
    imageDescription: 'Aurora wireless headphones on a desk',
    caption: 'Loving these Aurora headphones',
  });
  const result = verifyMultimodalIntentAgainstCatalog(candidate, aurora, NOW);
  assert.equal(result.status, 'eligible_for_exact_review');
  if (result.status === 'eligible_for_exact_review') {
    assert.equal(result.title, 'Aurora Wireless Noise-Cancelling Headphones');
    assert.equal(result.priceAmount, 249);
    assert.equal(result.currency, 'USD');
    assert.ok(result.matchedTerms.includes('aurora'));
    assert.ok(result.matchedTerms.includes('headphones'));
  }
});

test('caption $199 vs catalog $249 is drift, and the model/caption does not override the catalog', () => {
  const candidate = buildMultimodalIntentCandidate({
    imageDescription: 'Aurora wireless headphones',
    caption: 'Aurora headphones only $199 today!',
  });
  assert.equal(candidate.claimedPriceAmount, 199);
  const result = verifyMultimodalIntentAgainstCatalog(candidate, aurora, NOW);
  assert.equal(result.status, 'drift_reapproval_required');
  if (result.status === 'drift_reapproval_required') {
    assert.equal(result.reason, 'caption_price_mismatch');
    assert.equal(result.catalogPriceAmount, 249);
    assert.equal(result.claimedPriceAmount, 199);
  }
  // The claimed price is never presented as a price: no eligible result
  // exists for this candidate, so no exact review may be built from it.
  assert.notEqual(result.status, 'eligible_for_exact_review');
});

test('no catalog match is unverifiable, never an exact review', () => {
  const candidate = buildMultimodalIntentCandidate({
    imageDescription: 'Headphones in a Reel',
    caption: 'These headphones',
  });
  const result = verifyMultimodalIntentAgainstCatalog(candidate, null, NOW);
  assert.deepEqual(result, { status: 'unverifiable', reason: 'no_catalog_match' });
});

test('image-only intent without a catalog record is unverifiable', () => {
  const candidate = buildMultimodalIntentCandidate({
    imageDescription: 'A pair of wireless headphones',
  });
  assert.equal(candidate.hasImage, true);
  assert.equal(candidate.hasCaption, false);
  const result = verifyMultimodalIntentAgainstCatalog(candidate, null, NOW);
  assert.deepEqual(result, { status: 'unverifiable', reason: 'no_catalog_match' });
});

test('stale, unavailable, and title-mismatched catalog records are unverifiable', () => {
  const candidate = buildMultimodalIntentCandidate({
    imageDescription: 'Aurora wireless headphones',
    caption: 'Aurora headphones',
  });
  const stale = verifyMultimodalIntentAgainstCatalog(candidate, { ...aurora, updatedAt: '2026-10-20T10:00:00.000Z' }, NOW);
  assert.deepEqual(stale, { status: 'unverifiable', reason: 'catalog_stale' });
  const unavailable = verifyMultimodalIntentAgainstCatalog(candidate, { ...aurora, available: false }, NOW);
  assert.deepEqual(unavailable, { status: 'unverifiable', reason: 'catalog_unavailable' });
  const wrongTitle = verifyMultimodalIntentAgainstCatalog(candidate, { ...aurora, title: 'Classic Canvas Backpack' }, NOW);
  assert.deepEqual(wrongTitle, { status: 'unverifiable', reason: 'title_terms_no_match' });
});

test('empty intent is unverifiable, and raw IDs never reach candidate terms', () => {
  const empty = buildMultimodalIntentCandidate({});
  assert.deepEqual(verifyMultimodalIntentAgainstCatalog(empty, aurora, NOW), {
    status: 'unverifiable',
    reason: 'no_intent_terms',
  });
  const hostile = buildMultimodalIntentCandidate({
    caption: 'Aurora headphones gid://shopify/Product/123 test-store.myshopify.com acct_456',
  });
  assert.ok(!JSON.stringify(hostile).includes('gid://'));
  assert.ok(!JSON.stringify(hostile).includes('myshopify.com'));
  assert.ok(!JSON.stringify(hostile).includes('acct_'));
  assert.equal(stripRawIdsFromText('gid://shopify/Product/1 and acct_2').includes('gid://'), false);
});

test('caption price that matches the catalog is not drift', () => {
  const candidate = buildMultimodalIntentCandidate({
    imageDescription: 'Aurora wireless headphones',
    caption: 'Aurora headphones $249',
  });
  const result = verifyMultimodalIntentAgainstCatalog(candidate, aurora, NOW);
  assert.equal(result.status, 'eligible_for_exact_review');
});
