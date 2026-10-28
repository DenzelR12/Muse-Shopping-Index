import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MemoryPanelSessionTokenStore,
} from '../src/muse-panel-session-store.js';
import { createPanelSessionMount } from '../src/muse-panel-session-mount.js';

const NOW = '2026-10-27T12:00:00.000Z';
const EXPIRY = '2026-10-27T12:10:00.000Z'; // 10-minute draft life.
const LATER = '2026-10-27T12:11:00.000Z';
const PRINCIPAL = { subject: 'consumer-1', companyId: 'company-1' };
const OTHER = { subject: 'consumer-2', companyId: 'company-2' };

async function issuedStore() {
  const store = new MemoryPanelSessionTokenStore();
  await store.issue({
    sessionId: 'session-1', subject: 'consumer-1', companyId: 'company-1',
    draftId: 'draft-1', approvalToken: 'approval-token-from-session',
    draftExpiresAt: EXPIRY, now: NOW,
  });
  return store;
}

function hostDeps(calls: { approve: number; resume: number; optIn: number; optOut: number }) {
  return {
    approveDraft: async () => { calls.approve += 1; return { status: 'payment_processing' }; },
    resumeDraft: async () => {
      calls.resume += 1;
      return { kind: 'present_review', draftId: 'draft-1', approvalRequired: true, approvalCarried: false, executeAgain: false, freshBuy: false } as const;
    },
    optInReminder: async () => {
      calls.optIn += 1;
      return { consumerSubject: 'consumer-1', companyId: 'company-1', draftId: 'draft-1', status: 'PENDING', sentCount: 0, createdAt: NOW, updatedAt: NOW, sentAt: null } as const;
    },
    optOutReminder: async () => { calls.optOut += 1; return null; },
  };
}

test('session store issues and resolves a token only for the same principal, session, and draft', async () => {
  const store = await issuedStore();
  assert.equal(
    await store.resolveApprovalToken({ sessionId: 'session-1', principal: PRINCIPAL, draftId: 'draft-1', now: NOW }),
    'approval-token-from-session',
  );
  // Tenant isolation: another company's principal gets nothing, not an error leak.
  assert.equal(
    await store.resolveApprovalToken({ sessionId: 'session-1', principal: OTHER, draftId: 'draft-1', now: NOW }),
    undefined,
  );
  assert.deepEqual(
    await store.verifySession({ sessionId: 'session-1', principal: OTHER, draftId: 'draft-1', now: NOW }),
    { status: 'principal_mismatch' },
  );
  // Draft mismatch and unknown session are also nothing, never a token.
  assert.deepEqual(
    await store.verifySession({ sessionId: 'session-1', principal: PRINCIPAL, draftId: 'draft-2', now: NOW }),
    { status: 'draft_mismatch' },
  );
  assert.deepEqual(
    await store.verifySession({ sessionId: 'session-9', principal: PRINCIPAL, draftId: 'draft-1', now: NOW }),
    { status: 'missing' },
  );
});

test('session store expires with the draft and purges expired records', async () => {
  const store = await issuedStore();
  assert.deepEqual(
    await store.verifySession({ sessionId: 'session-1', principal: PRINCIPAL, draftId: 'draft-1', now: LATER }),
    { status: 'expired' },
  );
  assert.equal(
    await store.resolveApprovalToken({ sessionId: 'session-1', principal: PRINCIPAL, draftId: 'draft-1', now: LATER }),
    undefined,
  );
  assert.equal(await store.purgeExpired(LATER), 1);
  assert.deepEqual(
    await store.verifySession({ sessionId: 'session-1', principal: PRINCIPAL, draftId: 'draft-1', now: LATER }),
    { status: 'missing' },
  );
});

test('session store consume-once: second consume fails, and a consumed token resolves to nothing', async () => {
  const store = await issuedStore();
  const lookup = { sessionId: 'session-1', principal: PRINCIPAL, draftId: 'draft-1', now: NOW };
  assert.equal(await store.consume(lookup), true);
  assert.equal(await store.consume(lookup), false);
  assert.deepEqual(await store.verifySession(lookup), { status: 'consumed' });
  assert.equal(await store.resolveApprovalToken(lookup), undefined);
});

test('session store rejects an expiry that is already past at issue time', async () => {
  const store = new MemoryPanelSessionTokenStore();
  await assert.rejects(
    store.issue({
      sessionId: 'session-1', subject: 'consumer-1', companyId: 'company-1',
      draftId: 'draft-1', approvalToken: 'approval-token-from-session',
      draftExpiresAt: NOW, now: NOW,
    }),
    /muse_panel_session_expiry_invalid/,
  );
});

test('session mount fails closed with no store configured, calling no handler', async () => {
  const calls = { approve: 0, resume: 0, optIn: 0, optOut: 0 };
  const mount = createPanelSessionMount({
    store: null,
    resolveDraft: async () => ({ draftId: 'draft-1', companyId: 'company-1' }),
    hostDeps: hostDeps(calls),
    now: NOW,
  });
  const result = await mount.handlePanelSessionRequest({
    principal: PRINCIPAL, sessionId: 'session-1', draftId: 'draft-1', action: 'approve', now: NOW,
  });
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: 'muse_panel_session_store_not_configured' });
  assert.deepEqual(calls, { approve: 0, resume: 0, optIn: 0, optOut: 0 });
});

test('session mount fails closed on missing, expired, principal-mismatched, and consumed tokens', async () => {
  const store = await issuedStore();
  const calls = { approve: 0, resume: 0, optIn: 0, optOut: 0 };
  const mount = createPanelSessionMount({
    store,
    resolveDraft: async () => ({ draftId: 'draft-1', companyId: 'company-1' }),
    hostDeps: hostDeps(calls),
    now: NOW,
  });
  const missing = await mount.handlePanelSessionRequest({
    principal: PRINCIPAL, sessionId: 'session-9', draftId: 'draft-1', action: 'approve', now: NOW,
  });
  assert.deepEqual(missing, { status: 403, body: { error: 'muse_panel_session_token_not_found' } });
  const wrongDraft = await mount.handlePanelSessionRequest({
    principal: PRINCIPAL, sessionId: 'session-1', draftId: 'draft-2', action: 'approve', now: NOW,
  });
  assert.deepEqual(wrongDraft, { status: 400, body: { error: 'muse_panel_route_draft_mismatch' } });
  const wrongPrincipal = await mount.handlePanelSessionRequest({
    principal: OTHER, sessionId: 'session-1', draftId: 'draft-1', action: 'approve', now: NOW,
  });
  assert.deepEqual(wrongPrincipal, { status: 403, body: { error: 'provider_readiness_company_mismatch' } });
  const expired = await mount.handlePanelSessionRequest({
    principal: PRINCIPAL, sessionId: 'session-1', draftId: 'draft-1', action: 'approve', now: LATER,
  });
  assert.deepEqual(expired, { status: 410, body: { error: 'muse_panel_session_token_expired' } });
  await store.consume({ sessionId: 'session-1', principal: PRINCIPAL, draftId: 'draft-1', now: NOW });
  const consumed = await mount.handlePanelSessionRequest({
    principal: PRINCIPAL, sessionId: 'session-1', draftId: 'draft-1', action: 'approve', now: NOW,
  });
  assert.deepEqual(consumed, { status: 403, body: { error: 'muse_panel_session_token_consumed' } });
  assert.deepEqual(calls, { approve: 0, resume: 0, optIn: 0, optOut: 0 });
});

test('session mount approves exactly once through existing host wiring, and resume still reports state after consumption', async () => {
  const store = await issuedStore();
  const calls = { approve: 0, resume: 0, optIn: 0, optOut: 0 };
  const mount = createPanelSessionMount({
    store,
    resolveDraft: async () => ({ draftId: 'draft-1', companyId: 'company-1' }),
    hostDeps: hostDeps(calls),
    now: NOW,
  });
  const approve = await mount.handlePanelSessionRequest({
    principal: PRINCIPAL, sessionId: 'session-1', draftId: 'draft-1', action: 'approve', now: NOW,
  });
  assert.equal(approve.status, 202);
  assert.equal(calls.approve, 1);
  // Resume is a revalidate-first read, not a spend: it must still work
  // after approval so the panel can show execution state, never a
  // fresh Buy. (The approval flow's own consume-once is unchanged.)
  await store.consume({ sessionId: 'session-1', principal: PRINCIPAL, draftId: 'draft-1', now: NOW });
  const resume = await mount.handlePanelSessionRequest({
    principal: PRINCIPAL, sessionId: 'session-1', draftId: 'draft-1', action: 'resume', now: NOW,
  });
  assert.equal(resume.status, 200);
  assert.equal(calls.resume, 1);
});
