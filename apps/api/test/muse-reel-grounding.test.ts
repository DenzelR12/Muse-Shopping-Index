/**
 * Tests for muse-reel-grounding.ts.
 *
 * The LIVE_RUN fixture is transcribed from the 2026-10-29 live muse-spark-1.3
 * JSON probe (3 frames of the THEENRG studio reel, strict JSON output).
 * It is a recorded fixture, not a live call: these tests run offline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groundReelCandidates,
  MUSE_GROUNDING_UNCERTAIN,
  type GroundingCatalogItem,
  type ReelGroundingModelOutput,
} from '../src/muse-reel-grounding.js';

const LIVE_RUN_2026_10_29: ReelGroundingModelOutput = {
  visible: [
    { label: 'ENRG Unisex Oversized T-Shirt', seen_at: ['0:02', '0:12'], attributes: { garment: 't-shirt', color: 'navy' } },
    { label: 'HVU Mineral Wash Boxy Full Zip Hoodie', seen_at: ['0:07'], attributes: { garment: 'hoodie', color: 'black' } },
  ],
  featured: MUSE_GROUNDING_UNCERTAIN,
  candidates: ['ENRG Unisex Oversized T-Shirt', 'HVU Mineral Wash Boxy Full Zip Hoodie'],
  confidence: 'high',
  note: 'Both catalog products are clearly visible across the sampled frames with distinct branding details.',
};

const CATALOG: GroundingCatalogItem[] = [
  { title: 'ENRG Unisex Oversized T-Shirt', priceAmount: 44, currency: 'USD', status: 'verified' },
  { title: 'HVU Mineral Wash Boxy Full Zip Hoodie', priceAmount: 70, currency: 'USD', status: 'verified' },
];

const co = 'theenrg';

test('live 2026-10-29 run: UNCERTAIN + two verified candidates -> picker', () => {
  const r = groundReelCandidates({ modelOutput: LIVE_RUN_2026_10_29, catalog: CATALOG, companyId: co, principalCompanyId: co });
  assert.equal(r.verdict, 'picker');
  if (r.verdict === 'picker') {
    assert.equal(r.candidates.length, 2);
    assert.equal(r.candidates[0].item?.priceAmount, 44);
    assert.equal(r.candidates[1].item?.priceAmount, 70);
  }
});

test('featured names a verified item with high confidence -> exact', () => {
  const r = groundReelCandidates({
    modelOutput: { ...LIVE_RUN_2026_10_29, featured: 'ENRG Unisex Oversized T-Shirt' },
    catalog: CATALOG, companyId: co, principalCompanyId: co,
  });
  assert.equal(r.verdict, 'exact');
  if (r.verdict === 'exact') assert.equal(r.item.priceAmount, 44);
});

test('featured names a verified item but confidence medium -> picker, not exact', () => {
  const r = groundReelCandidates({
    modelOutput: { ...LIVE_RUN_2026_10_29, featured: 'ENRG Unisex Oversized T-Shirt', confidence: 'medium' },
    catalog: CATALOG, companyId: co, principalCompanyId: co,
  });
  assert.equal(r.verdict, 'picker');
});

test('featured names something not in the catalog -> fail closed (never guess)', () => {
  const r = groundReelCandidates({
    modelOutput: { ...LIVE_RUN_2026_10_29, featured: 'Aurora Wireless Headphones' },
    catalog: CATALOG, companyId: co, principalCompanyId: co,
  });
  assert.equal(r.verdict, 'fail-closed');
  if (r.verdict === 'fail-closed') assert.equal(r.reason, 'muse_grounding_featured_not_in_catalog');
});

test('no candidate matches a verified item -> fail closed', () => {
  const r = groundReelCandidates({
    modelOutput: { ...LIVE_RUN_2026_10_29, candidates: ['Mystery Jacket'] },
    catalog: CATALOG, companyId: co, principalCompanyId: co,
  });
  assert.equal(r.verdict, 'fail-closed');
  if (r.verdict === 'fail-closed') assert.equal(r.reason, 'muse_grounding_no_verified_candidate');
});

test('candidate matching an unverifiable catalog item is marked null, not priced', () => {
  const catalog: GroundingCatalogItem[] = [
    { title: 'ENRG Unisex Oversized T-Shirt', priceAmount: 44, currency: 'USD', status: 'verified' },
    { title: 'HVU Mineral Wash Boxy Full Zip Hoodie', priceAmount: 70, currency: 'USD', status: 'unverifiable' },
  ];
  const r = groundReelCandidates({ modelOutput: LIVE_RUN_2026_10_29, catalog, companyId: co, principalCompanyId: co });
  assert.equal(r.verdict, 'picker');
  if (r.verdict === 'picker') {
    assert.equal(r.candidates[0].item?.priceAmount, 44);
    assert.equal(r.candidates[1].item, null);
  }
});

test('tenant mismatch throws before anything else', () => {
  assert.throws(
    () => groundReelCandidates({ modelOutput: LIVE_RUN_2026_10_29, catalog: CATALOG, companyId: 'a', principalCompanyId: 'b' }),
    /muse_grounding_company_mismatch/,
  );
});

test('malformed model output fails closed', () => {
  const r = groundReelCandidates({ modelOutput: { nope: true }, catalog: CATALOG, companyId: co, principalCompanyId: co });
  assert.equal(r.verdict, 'fail-closed');
  if (r.verdict === 'fail-closed') assert.equal(r.reason, 'muse_grounding_malformed_output');
});
