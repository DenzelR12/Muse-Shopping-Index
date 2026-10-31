/**
 * Tests for muse-demo-grounding.ts — the public demo grounding route's
 * server logic. All model calls are mocked fetches; these tests run
 * offline and never spend model credit.
 *
 * The MIXED_REEL fixture is the recorded 2026-10-29 live muse-spark-1.3
 * JSON output for the mixed-product reel (UNCERTAIN, high confidence).
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDemoReelGrounding,
  isDemoReelId,
  resetDemoGroundingState,
} from '../src/muse-demo-grounding.js';

const MIXED_MODEL_JSON = JSON.stringify({
  visible: [
    { label: 'ENRG Unisex Oversized T-Shirt', seen_at: ['0:02', '0:12'], attributes: { garment: 't-shirt', color: 'navy' } },
    { label: 'HVU Unisex Mineral Wash Boxy Full Zip Hoodie', seen_at: ['0:07'], attributes: { garment: 'hoodie', color: 'black' } },
  ],
  featured: 'UNCERTAIN',
  candidates: ['ENRG Unisex Oversized T-Shirt', 'HVU Unisex Mineral Wash Boxy Full Zip Hoodie'],
  confidence: 'high',
  note: 'Both catalog products are clearly visible across the sampled frames.',
});

const TEE_MODEL_JSON = JSON.stringify({
  visible: [
    { label: 'ENRG Unisex Oversized T-Shirt', seen_at: ['0:02', '0:07', '0:12'], attributes: { garment: 't-shirt' } },
  ],
  featured: 'ENRG Unisex Oversized T-Shirt',
  candidates: ['ENRG Unisex Oversized T-Shirt'],
  confidence: 'high',
  note: 'Only the tee is visible.',
});

function mockFetchReturning(content: string, counter: { calls: number }): typeof fetch {
  return (async () => {
    counter.calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    } as Response;
  }) as typeof fetch;
}

const baseDeps = {
  apiKey: 'test-key-not-real',
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
};

beforeEach(() => {
  resetDemoGroundingState();
});

test('mixed reel: live UNCERTAIN grounds to the picker', async () => {
  const counter = { calls: 0 };
  const result = await getDemoReelGrounding('theenrg-mixed', {
    ...baseDeps,
    fetchImpl: mockFetchReturning(MIXED_MODEL_JSON, counter),
  });
  assert.equal(result.servedFrom, 'live');
  assert.equal(result.catalogSource, 'demo');
  assert.equal(result.grounding.verdict, 'picker');
  assert.equal(counter.calls, 1);
});

test('tee reel: confident exact match grounds to exact', async () => {
  const counter = { calls: 0 };
  const result = await getDemoReelGrounding('theenrg-tee', {
    ...baseDeps,
    fetchImpl: mockFetchReturning(TEE_MODEL_JSON, counter),
  });
  assert.equal(result.grounding.verdict, 'exact');
  if (result.grounding.verdict === 'exact') {
    assert.equal(result.grounding.item.title, 'ENRG Unisex Oversized T-Shirt');
    assert.equal(result.grounding.item.priceAmount, 44);
  }
});

test('second call is served from cache without another model call', async () => {
  const counter = { calls: 0 };
  const deps = { ...baseDeps, fetchImpl: mockFetchReturning(MIXED_MODEL_JSON, counter) };
  const first = await getDemoReelGrounding('theenrg-mixed', deps);
  const second = await getDemoReelGrounding('theenrg-mixed', deps);
  assert.equal(first.servedFrom, 'live');
  assert.equal(second.servedFrom, 'cache');
  assert.equal(second.modelRunAt, first.modelRunAt);
  assert.equal(counter.calls, 1);
});

test('malformed model output fails closed, never guesses', async () => {
  const counter = { calls: 0 };
  const result = await getDemoReelGrounding('theenrg-tee', {
    ...baseDeps,
    fetchImpl: mockFetchReturning('the featured product is probably the tee, trust me', counter),
  });
  assert.equal(result.grounding.verdict, 'fail-closed');
  assert.equal(result.modelOutput, null);
});

test('model naming a product outside the catalog fails closed', async () => {
  const counter = { calls: 0 };
  const invented = JSON.stringify({
    visible: [{ label: 'Aurora Wireless Headphones', seen_at: ['0:02'] }],
    featured: 'Aurora Wireless Headphones',
    candidates: ['Aurora Wireless Headphones'],
    confidence: 'high',
  });
  const result = await getDemoReelGrounding('theenrg-tee', {
    ...baseDeps,
    fetchImpl: mockFetchReturning(invented, counter),
  });
  assert.equal(result.grounding.verdict, 'fail-closed');
});

test('fresh-call budget: exhausted budget serves stale cache instead of calling', async () => {
  const counter = { calls: 0 };
  let nowMs = 1_000_000;
  const deps = {
    ...baseDeps,
    fetchImpl: mockFetchReturning(MIXED_MODEL_JSON, counter),
    now: () => nowMs,
    cacheTtlMs: 1000,
    maxFreshCallsPerHour: 1,
  };
  await getDemoReelGrounding('theenrg-mixed', deps);
  nowMs += 5000; // cache expired, budget (1/hour) spent
  const second = await getDemoReelGrounding('theenrg-mixed', deps);
  assert.equal(second.servedFrom, 'cache');
  assert.equal(counter.calls, 1);
});

test('reel id validation accepts only the two demo reels', () => {
  assert.equal(isDemoReelId('theenrg-tee'), true);
  assert.equal(isDemoReelId('theenrg-mixed'), true);
  assert.equal(isDemoReelId('anything-else'), false);
  assert.equal(isDemoReelId(undefined), false);
  assert.equal(isDemoReelId(42), false);
});
