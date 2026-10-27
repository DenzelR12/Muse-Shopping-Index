import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMusePanelMount } from '../src/muse-panel-mount.js';

const principal = { subject: 'consumer-1', companyId: 'company-1' };

function deps(overrides: Record<string, unknown> = {}) {
  const calls = { approve: 0, resume: 0, optIn: 0, optOut: 0 };
  return {
    calls,
    resolveDraft: async () => ({ draftId: 'draft-1', companyId: 'company-1' }),
    resolveApprovalToken: async () => 'approval-token-from-session',
    hostDeps: {
      approveDraft: async () => { calls.approve += 1; return { status: 'payment_processing' }; },
      resumeDraft: async () => {
        calls.resume += 1;
        return { kind: 'present_review', draftId: 'draft-1', approvalRequired: true, approvalCarried: false, executeAgain: false, freshBuy: false } as const;
      },
      optInReminder: async () => {
        calls.optIn += 1;
        return { consumerSubject: 'consumer-1', companyId: 'company-1', draftId: 'draft-1', status: 'PENDING', sentCount: 0, createdAt: '2026-10-27T12:00:00.000Z', updatedAt: '2026-10-27T12:00:00.000Z', sentAt: null } as const;
      },
      optOutReminder: async () => { calls.optOut += 1; return null; },
    },
    now: '2026-10-27T12:00:00.000Z',
    ...overrides,
  };
}

test('mount adapter approves, resumes, and opts in/out through existing host wiring, exactly once each', async () => {
  const d = deps();
  const approve = await handleMusePanelMount({ principal, draftId: 'draft-1', action: 'approve', deps: d });
  assert.equal(approve.status, 202);
  const resume = await handleMusePanelMount({ principal, draftId: 'draft-1', action: 'resume', deps: d });
  assert.equal(resume.status, 200);
  const optIn = await handleMusePanelMount({ principal, draftId: 'draft-1', action: 'reminder-opt-in', deps: d });
  assert.equal(optIn.status, 200);
  const optOut = await handleMusePanelMount({ principal, draftId: 'draft-1', action: 'reminder-opt-out', deps: d });
  assert.equal(optOut.status, 200);
  assert.deepEqual(d.calls, { approve: 1, resume: 1, optIn: 1, optOut: 1 });
});

test('mount adapter refuses without a principal, on missing draft, on draft-company mismatch, and on draft mismatch, calling no handler', async () => {
  const d = deps();
  const noPrincipal = await handleMusePanelMount({ principal: null, draftId: 'draft-1', action: 'approve', deps: d });
  assert.equal(noPrincipal.status, 401);
  const missing = await handleMusePanelMount({
    principal, draftId: 'draft-9', action: 'approve',
    deps: deps({ resolveDraft: async () => null }),
  });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: 'muse_panel_mount_draft_not_found' });
  const wrongCompany = await handleMusePanelMount({
    principal, draftId: 'draft-1', action: 'approve',
    deps: deps({ resolveDraft: async () => ({ draftId: 'draft-1', companyId: 'company-2' }) }),
  });
  assert.equal(wrongCompany.status, 403);
  assert.deepEqual(wrongCompany.body, { error: 'provider_readiness_company_mismatch' });
  const wrongDraft = await handleMusePanelMount({
    principal, draftId: 'draft-1', action: 'approve',
    deps: deps({ resolveDraft: async () => ({ draftId: 'draft-2', companyId: 'company-1' }) }),
  });
  assert.equal(wrongDraft.status, 400);
  assert.deepEqual(wrongDraft.body, { error: 'muse_panel_route_draft_mismatch' });
  assert.deepEqual(d.calls, { approve: 0, resume: 0, optIn: 0, optOut: 0 });
});

test('mount adapter refuses approval when the session has no token, and never reaches the approval flow', async () => {
  const d = deps({ resolveApprovalToken: async () => undefined });
  const result = await handleMusePanelMount({ principal, draftId: 'draft-1', action: 'approve', deps: d });
  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { error: 'approval_token_required' });
  assert.equal(d.calls.approve, 0);
});

test('mount adapter rejects an unknown action without calling a handler', async () => {
  const d = deps();
  const result = await handleMusePanelMount({ principal, draftId: 'draft-1', action: 'buy-now', deps: d });
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: 'muse_panel_route_action_unknown' });
  assert.deepEqual(d.calls, { approve: 0, resume: 0, optIn: 0, optOut: 0 });
});
