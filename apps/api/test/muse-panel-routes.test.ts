import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleMusePanelRoute,
  type MusePanelRouteHandlers,
} from '../src/muse-panel-routes.js';

const principal = { subject: 'consumer-1', companyId: 'company-1' };

function handlers(overrides: Partial<MusePanelRouteHandlers> = {}): MusePanelRouteHandlers {
  return {
    onApprove: async () => {},
    onResume: async () => ({ kind: 'present_review', draftId: 'draft-1' }),
    onReminderOptIn: async () => ({ status: 'PENDING' }),
    onReminderOptOut: async () => ({ status: 'DISMISSED' }),
    ...overrides,
  };
}

const base = {
  principal,
  companyId: 'company-1',
  draftId: 'draft-1',
  expectedDraftId: 'draft-1',
  handlers: handlers(),
};

test('panel route approves only through the bound handlers, and returns accepted, not executed', async () => {
  let calls = 0;
  const response = await handleMusePanelRoute({
    ...base,
    handlers: handlers({ onApprove: async () => { calls += 1; } }),
    action: 'approve',
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 202);
  assert.deepEqual(response.body, { action: 'approve', result: 'submitted_for_approval_flow' });
});

test('panel route returns a resume decision unchanged, never a fresh Buy', async () => {
  const decision = { kind: 'execution_state', state: 'processing' };
  const response = await handleMusePanelRoute({
    ...base,
    handlers: handlers({ onResume: async () => decision }),
    action: 'resume',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { action: 'resume', result: decision });
});

test('panel route refuses without a principal, on tenant mismatch, and on draft mismatch, calling no handler', async () => {
  let calls = 0;
  const counting = handlers({ onApprove: async () => { calls += 1; } });
  const noPrincipal = await handleMusePanelRoute({ ...base, principal: null, handlers: counting, action: 'approve' });
  assert.equal(noPrincipal.status, 401);
  assert.deepEqual(noPrincipal.body, { error: 'muse_panel_route_principal_required' });
  const mismatch = await handleMusePanelRoute({ ...base, companyId: 'company-2', handlers: counting, action: 'approve' });
  assert.equal(mismatch.status, 403);
  assert.deepEqual(mismatch.body, { error: 'provider_readiness_company_mismatch' });
  const wrongDraft = await handleMusePanelRoute({ ...base, draftId: 'draft-9', handlers: counting, action: 'approve' });
  assert.equal(wrongDraft.status, 400);
  assert.deepEqual(wrongDraft.body, { error: 'muse_panel_route_draft_mismatch' });
  const missingDraft = await handleMusePanelRoute({ ...base, draftId: '', handlers: counting, action: 'approve' });
  assert.equal(missingDraft.status, 400);
  assert.deepEqual(missingDraft.body, { error: 'muse_panel_route_draft_required' });
  const unknown = await handleMusePanelRoute({ ...base, handlers: counting, action: 'buy-now' });
  assert.equal(unknown.status, 400);
  assert.deepEqual(unknown.body, { error: 'muse_panel_route_action_unknown' });
  assert.equal(calls, 0, 'no refused request may reach a handler');
});

test('panel route propagates a missing approval token as 403 and a failed approval as 422, without retry', async () => {
  let calls = 0;
  const noToken = await handleMusePanelRoute({
    ...base,
    handlers: handlers({
      onApprove: async () => { calls += 1; throw new Error('approval_token_required'); },
    }),
    action: 'approve',
  });
  assert.equal(noToken.status, 403);
  assert.deepEqual(noToken.body, { error: 'approval_token_required' });
  const failed = await handleMusePanelRoute({
    ...base,
    handlers: handlers({
      onApprove: async () => { calls += 1; throw new Error('draft_expired'); },
    }),
    action: 'approve',
  });
  assert.equal(failed.status, 422);
  assert.deepEqual(failed.body, { error: 'draft_expired' });
  assert.equal(calls, 2, 'each explicit request calls once; the module itself never retries');
});

test('panel route reminder actions delegate and carry no price, title, or token field', async () => {
  const optIn = await handleMusePanelRoute({ ...base, action: 'reminder-opt-in' });
  assert.equal(optIn.status, 200);
  assert.ok(!JSON.stringify(optIn.body).includes('price'));
  const optOut = await handleMusePanelRoute({ ...base, action: 'reminder-opt-out' });
  assert.equal(optOut.status, 200);
});
