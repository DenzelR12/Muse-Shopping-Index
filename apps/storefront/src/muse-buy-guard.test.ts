import test from 'node:test';
import assert from 'node:assert/strict';
import {decideBuyResume,MuseBuyGuard,attachMuseBuyGuard} from './muse-buy-guard.js';

function button(draftId = 'draft-1') {
  return {disabled: false, textContent: 'Buy now', dataset: {draftId}};
}

test('Buy guard disables immediately and ignores a second in-flight click', async () => {
  let submits = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const guard = new MuseBuyGuard(button(), {
    submit: async () => { submits++; await pending; },
    readOwnedStatus: async () => ({state: 'ORDER_CREATED'}),
  });
  const first = guard.click();
  assert.equal(guard.isInFlight, true);
  // The button in the test double is the same object the guard mutates.
  const second = await guard.click();
  assert.deepEqual(second, {accepted: false, reason: 'already_submitting'});
  assert.equal(submits, 1);
  release();
  const result = await first;
  assert.deepEqual(result, {accepted: true});
  // Progress preserved: still disabled after a successful submit.
  assert.equal(submits, 1);
});

test('Buy guard re-enables after a failed submit, without auto-retry', async () => {
  const btn = button();
  let submits = 0;
  const guard = new MuseBuyGuard(btn, {
    submit: async () => { submits++; throw new Error('network_failed'); },
    readOwnedStatus: async () => ({state: 'ORDER_CREATED'}),
  });
  await assert.rejects(guard.click(), /network_failed/);
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Buy now');
  assert.equal(guard.isInFlight, false);
  assert.equal(submits, 1);
});

test('Buy resume re-reads owned status and does not require a new approval for processing or fallback', async () => {
  for (const state of ['CHECKOUT_CREATED', 'PAYMENT_FALLBACK_PENDING', 'IN_PROGRESS']) {
    const btn = button();
    const guard = new MuseBuyGuard(btn, {
      submit: async () => {},
      readOwnedStatus: async (draftId) => { assert.equal(draftId, 'draft-1'); return {state}; },
    });
    const decision = await guard.resume();
    assert.equal(decision.requiresNewApproval, false);
    assert.equal(decision.action, 'resume');
    assert.equal(btn.disabled, true);
  }
});

test('Buy resume requires fresh approval only on drift or expiry', async () => {
  for (const status of [{state: 'IN_PROGRESS', drift: true}, {state: 'CHECKOUT_CREATED', expired: true}]) {
    const btn = button();
    const guard = new MuseBuyGuard(btn, {
      submit: async () => {},
      readOwnedStatus: async () => status,
    });
    const decision = await guard.resume();
    assert.deepEqual(decision, {action: 'reapproval_required', requiresNewApproval: true});
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, 'Buy now');
  }
});

test('Buy resume marks completed and reconciliation without a new submission', async () => {
  const completed = await new MuseBuyGuard(button(), {
    submit: async () => { throw new Error('must_not_submit'); },
    readOwnedStatus: async () => ({state: 'ORDER_CREATED'}),
  }).resume();
  assert.deepEqual(completed, {action: 'completed', requiresNewApproval: false});

  const reconciling = await new MuseBuyGuard(button(), {
    submit: async () => { throw new Error('must_not_submit'); },
    readOwnedStatus: async () => ({state: 'RECONCILE_REQUIRED'}),
  }).resume();
  assert.deepEqual(reconciling, {action: 'reconciliation', requiresNewApproval: false});
});

test('decideBuyResume fails closed on unknown status', () => {
  assert.deepEqual(decideBuyResume({state: 'SOMETHING_NEW'}), {action: 'reapproval_required', requiresNewApproval: true});
});

test('attachMuseBuyGuard wires data-muse-buy buttons and ignores duplicates in flight', async () => {
  const btn = button();
  const listeners: Array<() => void> = [];
  (btn as any).addEventListener = (_type: string, listener: () => void) => { listeners.push(listener); };
  const root = {querySelectorAll: () => [btn]};
  let submits = 0;
  const guards = attachMuseBuyGuard(root, {
    submit: async () => { submits++; await new Promise((r) => setTimeout(r, 5)); },
    readOwnedStatus: async () => ({state: 'ORDER_CREATED'}),
  });
  assert.equal(guards.length, 1);
  assert.equal(guards[0].draftId, 'draft-1');
  listeners[0]();
  listeners[0]();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(submits, 1);
  assert.equal(btn.disabled, true);
});
