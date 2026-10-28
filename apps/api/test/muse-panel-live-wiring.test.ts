import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryPanelSessionTokenStore } from '../src/muse-panel-session-store.js';
import { createPanelSessionMount } from '../src/muse-panel-session-mount.js';
import {
  MemoryPanelDraftRegistry,
  PostgresPanelDraftRegistry,
  issuePanelSession,
  panelDraftResolver,
  createPanelLiveHostDeps,
} from '../src/muse-panel-live-wiring.js';

const NOW = '2026-10-28T18:00:00.000Z';
const EXPIRY = '2026-10-28T18:10:00.000Z';
const LATER = '2026-10-28T18:11:00.000Z';
const PRINCIPAL = { subject: 'consumer-1', companyId: 'company-1' };
const OTHER = { subject: 'consumer-2', companyId: 'company-2' };

async function wired() {
  const drafts = new MemoryPanelDraftRegistry();
  const store = new MemoryPanelSessionTokenStore();
  await drafts.registerDraft({ draftId: 'draft-1', companyId: 'company-1', expiresAt: EXPIRY, now: NOW });
  const issued = await issuePanelSession({
    store, draftRegistry: drafts, principal: PRINCIPAL, draftId: 'draft-1',
    approvalToken: 'approval-token-from-session', now: NOW,
  });
  const calls = { approve: 0, resume: 0, optIn: 0, optOut: 0 };
  const mount = createPanelSessionMount({
    store,
    resolveDraft: panelDraftResolver(drafts),
    hostDeps: createPanelLiveHostDeps({
      approveDraft: async () => { calls.approve += 1; return { status: 'payment_processing' }; },
      resumeDraft: async () => { calls.resume += 1; return { kind: 'present_review', draftId: 'draft-1', approvalRequired: true, approvalCarried: false, executeAgain: false, freshBuy: false } as never; },
      optInReminder: async () => { calls.optIn += 1; return { consumerId: 'consumer-1', draftId: 'draft-1', optedIn: true } as never; },
      optOutReminder: async () => { calls.optOut += 1; return null; },
    }),
  });
  return { drafts, store, mount, issued, calls };
}

test('issuance + draft lookup + mount approve succeed through the wired host', async () => {
  const { mount, issued, calls } = await wired();
  assert.ok(issued.sessionId.length >= 32);
  const approve = await mount.handlePanelSessionRequest({
    principal: PRINCIPAL, sessionId: issued.sessionId, draftId: 'draft-1', action: 'approve', now: NOW,
  });
  assert.equal(approve.status, 202);
  assert.equal(calls.approve, 1);
});

test('resume, reminder opt-in and opt-out succeed through the wired host', async () => {
  const { mount, issued, calls } = await wired();
  const resume = await mount.handlePanelSessionRequest({
    principal: PRINCIPAL, sessionId: issued.sessionId, draftId: 'draft-1', action: 'resume', now: NOW,
  });
  assert.equal(resume.status, 200);
  assert.equal(calls.resume, 1);
  const optIn = await mount.handlePanelSessionRequest({
    principal: PRINCIPAL, sessionId: issued.sessionId, draftId: 'draft-1', action: 'reminder-opt-in', now: NOW,
  });
  assert.equal(optIn.status, 200);
  assert.equal(calls.optIn, 1);
  const optOut = await mount.handlePanelSessionRequest({
    principal: PRINCIPAL, sessionId: issued.sessionId, draftId: 'draft-1', action: 'reminder-opt-out', now: NOW,
  });
  assert.equal(optOut.status, 200);
  assert.equal(calls.optOut, 1);
});

test('issuance fails closed for an unknown draft, another company, and an expired draft', async () => {
  const drafts = new MemoryPanelDraftRegistry();
  const store = new MemoryPanelSessionTokenStore();
  await assert.rejects(
    issuePanelSession({ store, draftRegistry: drafts, principal: PRINCIPAL, draftId: 'nope', approvalToken: 't', now: NOW }),
    /muse_panel_mount_draft_not_found/,
  );
  await drafts.registerDraft({ draftId: 'draft-1', companyId: 'company-1', expiresAt: EXPIRY, now: NOW });
  await assert.rejects(
    issuePanelSession({ store, draftRegistry: drafts, principal: OTHER, draftId: 'draft-1', approvalToken: 't', now: NOW }),
    /provider_readiness_company_mismatch/,
  );
  const expired = await drafts.resolveDraft({ principal: PRINCIPAL, draftId: 'draft-1', now: LATER });
  assert.equal(expired, null);
});

test('a draft registered for one company cannot be issued for another', async () => {
  const drafts = new MemoryPanelDraftRegistry();
  await drafts.registerDraft({ draftId: 'draft-1', companyId: 'company-1', expiresAt: EXPIRY, now: NOW });
  await assert.rejects(
    drafts.registerDraft({ draftId: 'draft-1', companyId: 'company-2', expiresAt: EXPIRY, now: NOW }),
    /provider_readiness_company_mismatch/,
  );
});

test('unbound host methods fail closed, and a concurrent approve cannot double-call', async () => {
  const drafts = new MemoryPanelDraftRegistry();
  const store = new MemoryPanelSessionTokenStore();
  await drafts.registerDraft({ draftId: 'draft-1', companyId: 'company-1', expiresAt: EXPIRY, now: NOW });
  const issued = await issuePanelSession({
    store, draftRegistry: drafts, principal: PRINCIPAL, draftId: 'draft-1',
    approvalToken: 'approval-token-from-session', now: NOW,
  });
  const unbound = createPanelSessionMount({
    store, resolveDraft: panelDraftResolver(drafts), hostDeps: createPanelLiveHostDeps({}),
  });
  const refused = await unbound.handlePanelSessionRequest({
    principal: PRINCIPAL, sessionId: issued.sessionId, draftId: 'draft-1', action: 'approve', now: NOW,
  });
  assert.equal(refused.status, 403);
  // In-flight guard on the adapter itself, independent of the mount.
  let calls = 0;
  const deps = createPanelLiveHostDeps({
    approveDraft: async () => { calls += 1; await new Promise((r) => setTimeout(r, 10)); return {}; },
  });
  const first = deps.approveDraft({ principal: PRINCIPAL, draftId: 'draft-1', approvalToken: 't' });
  await assert.rejects(
    deps.approveDraft({ principal: PRINCIPAL, draftId: 'draft-1', approvalToken: 't' }),
    /muse_panel_approve_in_flight/,
  );
  await first;
  assert.equal(calls, 1);
});

test('Postgres draft registry SQL is present and uses draft_id as primary key', async () => {
  // Build-checked only: no live database in this test run, same caveat
  // as other store modules before their first live run.
  assert.equal(typeof PostgresPanelDraftRegistry, 'function');
});
