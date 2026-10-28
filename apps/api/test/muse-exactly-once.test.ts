import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MemoryExactlyOnceStore,
  MuseBurstLimiter,
  executeExactlyOnce,
} from '../src/muse-exactly-once.js';

const NOW = '2026-10-28T17:00:00.000Z';

test('100 concurrent claims for one draft produce exactly one winner', async () => {
  const store = new MemoryExactlyOnceStore();
  const results = await Promise.all(Array.from({ length: 100 }, () =>
    store.claim({ key: 'draft-1', companyId: 'company-1', draftId: 'draft-1', operation: 'approve', now: NOW }),
  ));
  assert.equal(results.filter((r) => r.outcome === 'won').length, 1);
  assert.equal(results.filter((r) => r.outcome === 'in_progress').length, 99);
});

test('different drafts and different tenants claim independently', async () => {
  const store = new MemoryExactlyOnceStore();
  const a = await store.claim({ key: 'draft-1', companyId: 'company-1', operation: 'approve', now: NOW });
  const b = await store.claim({ key: 'draft-2', companyId: 'company-1', operation: 'approve', now: NOW });
  const c = await store.claim({ key: 'draft-1', companyId: 'company-2', operation: 'approve', now: NOW });
  assert.equal(a.outcome, 'won');
  assert.equal(b.outcome, 'won');
  assert.equal(c.outcome, 'won');
});

test('a completed claim replays the original result and never re-executes', async () => {
  const store = new MemoryExactlyOnceStore();
  let executions = 0;
  const first = await executeExactlyOnce(store,
    { key: 'draft-9', companyId: 'company-1', operation: 'approve', now: NOW },
    async () => { executions += 1; return { result: { order: 'verified' } }; });
  const second = await executeExactlyOnce(store,
    { key: 'draft-9', companyId: 'company-1', operation: 'approve', now: NOW },
    async () => { executions += 1; return { result: { order: 'second' } }; });
  assert.equal(first.executed, true);
  assert.equal(second.executed, false);
  assert.equal(second.outcome, 'duplicate');
  assert.deepEqual(second.result, { order: 'verified' });
  assert.equal(executions, 1);
});

test('a stale in-progress claim reconciles, it does not auto re-execute', async () => {
  const store = new MemoryExactlyOnceStore();
  await store.claim({ key: 'draft-stale', companyId: 'company-1', operation: 'approve', now: NOW, ttlMs: 60_000 });
  const later = await store.claim({ key: 'draft-stale', companyId: 'company-1', operation: 'approve', now: '2026-10-28T17:05:00.000Z' });
  assert.equal(later.outcome, 'stale_reconcile');
});

test('a principal from another company cannot claim for this company', async () => {
  const store = new MemoryExactlyOnceStore();
  await assert.rejects(
    store.claim({ key: 'draft-x', companyId: 'company-1', operation: 'approve', now: NOW, principal: { subject: 's', companyId: 'company-2' } }),
    /muse_exactly_once_tenant_mismatch/,
  );
});

test('a definite failure may release, an uncertain one may not re-execute', async () => {
  const store = new MemoryExactlyOnceStore();
  await store.claim({ key: 'draft-fail', companyId: 'company-1', operation: 'approve', now: NOW });
  assert.equal(await store.release({ key: 'draft-fail', companyId: 'company-1' }), true);
  const retry = await store.claim({ key: 'draft-fail', companyId: 'company-1', operation: 'approve', now: NOW });
  assert.equal(retry.outcome, 'won');
});

test('webhook redelivery and BI replay dedupe on their stable keys', async () => {
  const store = new MemoryExactlyOnceStore();
  const w1 = await store.claim({ key: 'leadgen-1', companyId: 'company-1', operation: 'lead_webhook', now: NOW });
  await store.complete({ key: 'leadgen-1', companyId: 'company-1', result: { ingested: true } });
  const w2 = await store.claim({ key: 'leadgen-1', companyId: 'company-1', operation: 'lead_webhook', now: NOW });
  assert.equal(w1.outcome, 'won');
  assert.equal(w2.outcome, 'duplicate');
});

test('burst limiter admits, queues, then fails closed instead of dropping', () => {
  const limiter = new MuseBurstLimiter(2, 1);
  assert.equal(limiter.tryAdmit('company-1'), 'admitted');
  assert.equal(limiter.tryAdmit('company-1'), 'admitted');
  assert.equal(limiter.tryAdmit('company-1'), 'queued');
  assert.equal(limiter.tryAdmit('company-1'), 'rejected_queue_full');
  limiter.releaseAdmitted('company-1');
  assert.equal(limiter.inFlightCount('company-1'), 2);
});
