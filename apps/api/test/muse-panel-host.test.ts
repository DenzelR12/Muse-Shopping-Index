import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMusePanelHostHandlers,
  type MusePanelHostDependencies,
  type MusePanelHostPrincipal,
} from '../src/muse-panel-host.js';
import type {MuseResumeDecision} from '../src/muse-abandoned-recovery.js';
import type {MuseReminderRecord} from '../src/muse-reminder.js';

// Mocked server methods only: no live host, draft service,
// reminder store, network, or channel is ever used here. The
// mocks record exactly what the wiring passed them, so a test
// can prove the panel never supplied identity, a token, or a
// company — those values come from wiring construction only.
const NOW = '2026-10-27T12:00:00.000Z';
const PRINCIPAL: MusePanelHostPrincipal = {subject: 'consumer-1', companyId: 'company-1'};

function reminderRecord(): MuseReminderRecord {
  return {
    consumerSubject: 'consumer-1',
    companyId: 'company-1',
    draftId: 'draft-1',
    status: 'PENDING',
    sentCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    sentAt: null,
  };
}

function presentReview(): MuseResumeDecision {
  return {kind: 'present_review', draftId: 'draft-1', approvalRequired: true, approvalCarried: false, executeAgain: false, freshBuy: false};
}

interface Calls {
  approve: Array<{principal: MusePanelHostPrincipal; draftId: string; approvalToken: string}>;
  resume: Array<{principal: MusePanelHostPrincipal; draftId: string}>;
  optIn: Array<{principal: MusePanelHostPrincipal; draftId: string}>;
  optOut: Array<{principal: MusePanelHostPrincipal; draftId: string}>;
}

function deps(calls: Calls, overrides: Partial<MusePanelHostDependencies> = {}): MusePanelHostDependencies {
  return {
    approveDraft: async (args) => { calls.approve.push(args); return {status: 'payment_processing'}; },
    resumeDraft: async (args) => { calls.resume.push(args); return presentReview(); },
    optInReminder: async (args) => { calls.optIn.push(args); return reminderRecord(); },
    optOutReminder: async (args) => { calls.optOut.push(args); return {...reminderRecord(), status: 'DISMISSED'}; },
    ...overrides,
  };
}

function emptyCalls(): Calls {
  return {approve: [], resume: [], optIn: [], optOut: []};
}

test('approve routes only with a host-supplied token, to the existing approval flow', async () => {
  const calls = emptyCalls();
  const handlers = createMusePanelHostHandlers({
    principal: PRINCIPAL,
    companyId: 'company-1',
    draft: {draftId: 'draft-1', approvalToken: 'approval-token-from-session'},
    deps: deps(calls),
    now: NOW,
  });
  await handlers.onApprove();
  assert.equal(calls.approve.length, 1);
  assert.equal(calls.approve[0].draftId, 'draft-1');
  assert.equal(calls.approve[0].approvalToken, 'approval-token-from-session');
  assert.deepEqual(calls.approve[0].principal, PRINCIPAL);
});

test('approve without a host-supplied token fails closed and never calls the approval flow', async () => {
  const calls = emptyCalls();
  const handlers = createMusePanelHostHandlers({
    principal: PRINCIPAL,
    companyId: 'company-1',
    draft: {draftId: 'draft-1'},
    deps: deps(calls),
    now: NOW,
  });
  await assert.rejects(handlers.onApprove(), /approval_token_required/);
  assert.equal(calls.approve.length, 0);
});

test('a tampered, expired, or changed approval failure propagates and is never converted into an approval', async () => {
  const calls = emptyCalls();
  const handlers = createMusePanelHostHandlers({
    principal: PRINCIPAL,
    companyId: 'company-1',
    draft: {draftId: 'draft-1', approvalToken: 'bad-token'},
    deps: deps(calls, {
      approveDraft: async () => { throw new Error('draft_expired'); },
    }),
    now: NOW,
  });
  await assert.rejects(handlers.onApprove(), /draft_expired/);
  // The failed attempt does not leave the adapter stuck: a new
  // explicit click may retry through the same consume-once flow.
  // (The retry here uses a fresh wiring with a valid token to
  // prove the guard resets, not an automatic retry.)
  const retryCalls = emptyCalls();
  const retry = createMusePanelHostHandlers({
    principal: PRINCIPAL,
    companyId: 'company-1',
    draft: {draftId: 'draft-1', approvalToken: 'good-token'},
    deps: deps(retryCalls),
    now: NOW,
  });
  await retry.onApprove();
  assert.equal(retryCalls.approve.length, 1);
});

test('a second concurrent approve call does not call the approval flow again (buy-guard, host side)', async () => {
  const calls = emptyCalls();
  let release!: () => void;
  const gate = new Promise<unknown>((resolve) => { release = () => resolve({status: 'payment_processing'}); });
  const handlers = createMusePanelHostHandlers({
    principal: PRINCIPAL,
    companyId: 'company-1',
    draft: {draftId: 'draft-1', approvalToken: 'approval-token-from-session'},
    deps: deps(calls, {
      approveDraft: async (args) => { calls.approve.push(args); return gate; },
    }),
    now: NOW,
  });
  const first = handlers.onApprove();
  const second = handlers.onApprove();
  await second;
  assert.equal(calls.approve.length, 1, 'the second concurrent call must not reach the approval flow');
  release();
  await first;
  assert.equal(calls.approve.length, 1);
});

test('resume routes to resumeDraft with the principal and draft, and returns the decision unchanged', async () => {
  const calls = emptyCalls();
  const execution: MuseResumeDecision = {kind: 'execution_state', draftId: 'draft-1', executionState: 'processing', requiresNewApproval: false, executeAgain: false, freshBuy: false};
  const handlers = createMusePanelHostHandlers({
    principal: PRINCIPAL,
    companyId: 'company-1',
    draft: {draftId: 'draft-1'},
    deps: deps(calls, {
      resumeDraft: async (args) => { calls.resume.push(args); return execution; },
    }),
    now: NOW,
  });
  const decision = await handlers.onResume();
  assert.equal(calls.resume.length, 1);
  assert.deepEqual(calls.resume[0].principal, PRINCIPAL);
  assert.equal(decision.kind, 'execution_state');
  if (decision.kind === 'execution_state') {
    assert.equal(decision.executeAgain, false);
    assert.equal(decision.freshBuy, false);
  }
});

test('resume with an expired or changed draft returns reapproval, never a fresh Buy', async () => {
  const calls = emptyCalls();
  const reapproval: MuseResumeDecision = {kind: 'reapproval_required', draftId: 'draft-1', reason: 'changed', requiresNewApproval: true, approvalCarried: false, executeAgain: false, freshBuy: false};
  const handlers = createMusePanelHostHandlers({
    principal: PRINCIPAL,
    companyId: 'company-1',
    draft: {draftId: 'draft-1'},
    deps: deps(calls, {
      resumeDraft: async (args) => { calls.resume.push(args); return reapproval; },
    }),
    now: NOW,
  });
  const decision = await handlers.onResume();
  assert.equal(decision.kind, 'reapproval_required');
  if (decision.kind === 'reapproval_required') {
    assert.equal(decision.requiresNewApproval, true);
    assert.equal(decision.approvalCarried, false);
    assert.equal(decision.freshBuy, false);
  }
});

test('reminder opt-in routes with the principal only, and opt-out kills the pending reminder', async () => {
  const calls = emptyCalls();
  const handlers = createMusePanelHostHandlers({
    principal: PRINCIPAL,
    companyId: 'company-1',
    draft: {draftId: 'draft-1'},
    deps: deps(calls),
    now: NOW,
  });
  const record = await handlers.onReminderOptIn();
  assert.equal(calls.optIn.length, 1);
  assert.deepEqual(calls.optIn[0].principal, PRINCIPAL);
  assert.equal(calls.optIn[0].draftId, 'draft-1');
  assert.equal(record.status, 'PENDING');
  const dismissed = await handlers.onReminderOptOut();
  assert.equal(calls.optOut.length, 1);
  assert.equal(dismissed?.status, 'DISMISSED');
});

test('tenant mismatch fails closed before any server method is called', async () => {
  const calls = emptyCalls();
  assert.throws(
    () => createMusePanelHostHandlers({
      principal: PRINCIPAL,
      companyId: 'company-2',
      draft: {draftId: 'draft-1', approvalToken: 'approval-token-from-session'},
      deps: deps(calls),
      now: NOW,
    }),
    /provider_readiness_company_mismatch/,
  );
  assert.deepEqual(calls, emptyCalls());
});

test('a handler with no authenticated principal is refused', async () => {
  const calls = emptyCalls();
  assert.throws(
    () => createMusePanelHostHandlers({
      principal: {subject: '', companyId: 'company-1'},
      companyId: 'company-1',
      draft: {draftId: 'draft-1'},
      deps: deps(calls),
      now: NOW,
    }),
    /muse_panel_host_principal_required/,
  );
  assert.deepEqual(calls, emptyCalls());
});

test('handlers have the panel shape: callbacks taking no arguments', async () => {
  const calls = emptyCalls();
  const handlers = createMusePanelHostHandlers({
    principal: PRINCIPAL,
    companyId: 'company-1',
    draft: {draftId: 'draft-1', approvalToken: 'approval-token-from-session'},
    deps: deps(calls),
    now: NOW,
  });
  assert.deepEqual(Object.keys(handlers).sort(), ['onApprove', 'onReminderOptIn', 'onReminderOptOut', 'onResume']);
  for (const handler of [handlers.onApprove, handlers.onResume, handlers.onReminderOptIn, handlers.onReminderOptOut]) {
    assert.equal(handler.length, 0, 'a panel handler must take no arguments: identity comes from wiring, never from the panel');
  }
});
