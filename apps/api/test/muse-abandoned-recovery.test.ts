import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReviewDiff,
  draftExpiryWarning,
  findOwnedResumeDraft,
  isDraftExpired,
  purgeEligibleReminderRecords,
  revalidateAndResume,
  resumeDraftDecision,
  MUSE_DRAFT_EXPIRY_WARNING_MS,
  type MuseResumeDraftSnapshot,
} from '../src/muse-abandoned-recovery.js';

// Mocked providers / draft service only: no live Meta, Shop,
// payment, or catalog call, no real consumer, no real draft,
// and no channel credentials are used here.
const NOW = '2026-10-27T12:00:00.000Z';
const FRESH_EXPIRY = '2026-10-27T12:09:00.000Z'; // 9 minutes out: inside the 10-minute draft life, outside the 2-minute warning window
const PAST_EXPIRY = '2026-10-27T11:00:00.000Z';
const PRINCIPAL = {subject: 'consumer-1', companyId: 'company-1'};

function draft(overrides: Partial<MuseResumeDraftSnapshot> = {}): MuseResumeDraftSnapshot {
  return {
    draftId: 'draft-1',
    companyId: 'company-1',
    consumerSubject: 'consumer-1',
    connectionId: 'conn-1',
    expiresAt: FRESH_EXPIRY,
    total: '277',
    currency: 'USD',
    shippingAmount: '8',
    taxAmount: '20',
    changedSinceReview: false,
    approved: false,
    ...overrides,
  };
}

test('resume to an existing unapproved draft returns present_review, not a new search', () => {
  const decision = resumeDraftDecision({principal: PRINCIPAL, draft: draft(), now: NOW});
  assert.equal(decision.kind, 'present_review');
  if (decision.kind === 'present_review') {
    assert.equal(decision.approvalRequired, true);
    assert.equal(decision.approvalCarried, false);
    assert.equal(decision.executeAgain, false);
    assert.equal(decision.freshBuy, false);
  }
});

test('resume with an expired draft requires reapproval and carries no approval', async () => {
  const decision = resumeDraftDecision({principal: PRINCIPAL, draft: draft({expiresAt: PAST_EXPIRY}), now: NOW});
  assert.equal(decision.kind, 'reapproval_required');
  if (decision.kind === 'reapproval_required') {
    assert.equal(decision.reason, 'expired');
    assert.equal(decision.approvalCarried, false);
  }
  // Revalidation supplies a new draft: new review, diff, fresh approval, no carry-over.
  let revalidateCalls = 0;
  const result = await revalidateAndResume({
    principal: PRINCIPAL,
    draft: draft({expiresAt: PAST_EXPIRY}),
    now: NOW,
    revalidate: async () => { revalidateCalls++; return draft({draftId: 'draft-2', total: '285', shippingAmount: '16'}); },
  });
  assert.equal(revalidateCalls, 1);
  assert.equal(result.kind, 'revalidated_review');
  if (result.kind === 'revalidated_review') {
    assert.equal(result.newDraft.draftId, 'draft-2');
    assert.equal(result.requiresNewApproval, true);
    assert.equal(result.approvalCarried, false);
    assert.match(result.diff.text, /Total changed from \$277 USD to \$285 USD/);
    assert.match(result.diff.text, /Shipping changed from \$8 USD to \$16 USD/);
    assert.match(result.diff.text, /old approval no longer applies/);
  }
});

test('resume with a changed price requires a new review with a diff and fresh approval', async () => {
  const decision = resumeDraftDecision({principal: PRINCIPAL, draft: draft({changedSinceReview: true}), now: NOW});
  assert.equal(decision.kind, 'reapproval_required');
  if (decision.kind === 'reapproval_required') assert.equal(decision.reason, 'changed');
  const result = await revalidateAndResume({
    principal: PRINCIPAL,
    draft: draft({changedSinceReview: true}),
    now: NOW,
    revalidate: async () => draft({draftId: 'draft-2', total: '285'}),
  });
  assert.equal(result.kind, 'revalidated_review');
  if (result.kind === 'revalidated_review') assert.match(result.diff.text, /Total changed from \$277 USD to \$285 USD/);
});

test('revalidation is not called for a present_review or execution_state resume, and a failed revalidation shows no review', async () => {
  let calls = 0;
  const present = await revalidateAndResume({principal: PRINCIPAL, draft: draft(), now: NOW, revalidate: async () => { calls++; return draft({draftId: 'draft-2'}); }});
  assert.equal(present.kind, 'present_review');
  assert.equal(calls, 0);
  const failed = await revalidateAndResume({principal: PRINCIPAL, draft: draft({expiresAt: PAST_EXPIRY}), now: NOW, revalidate: async () => null});
  assert.equal(failed.kind, 'revalidation_failed');
  const wrongTenant = await revalidateAndResume({
    principal: PRINCIPAL, draft: draft({expiresAt: PAST_EXPIRY}), now: NOW,
    revalidate: async () => draft({draftId: 'draft-2', companyId: 'company-2'}),
  });
  assert.equal(wrongTenant.kind, 'revalidation_failed');
});

test('resume post-approval never offers a fresh Buy and never executes again', () => {
  for (const executionState of ['processing', 'completed', 'reconciliation', 'authentication_required'] as const) {
    const decision = resumeDraftDecision({principal: PRINCIPAL, draft: draft({approved: true, executionState}), now: NOW});
    assert.equal(decision.kind, 'execution_state');
    if (decision.kind === 'execution_state') {
      assert.equal(decision.requiresNewApproval, false);
      assert.equal(decision.executeAgain, false);
      assert.equal(decision.freshBuy, false);
      assert.equal(decision.executionState, executionState);
    }
  }
  // Approved without a recorded execution state yet is still processing, not a fresh Buy.
  const approved = resumeDraftDecision({principal: PRINCIPAL, draft: draft({approved: true}), now: NOW});
  assert.equal(approved.kind, 'execution_state');
  if (approved.kind === 'execution_state') {
    assert.equal(approved.requiresNewApproval, false);
    assert.equal(approved.executeAgain, false);
    assert.equal(approved.freshBuy, false);
  }
});

test('tenant and consumer mismatch on resume fail closed', () => {
  assert.throws(
    () => resumeDraftDecision({principal: PRINCIPAL, draft: draft({companyId: 'company-2'}), now: NOW}),
    /provider_readiness_company_mismatch/,
  );
  assert.throws(
    () => resumeDraftDecision({principal: PRINCIPAL, draft: draft({consumerSubject: 'consumer-2'}), now: NOW}),
    /consumer_agent_not_found/,
  );
});

test('findOwnedResumeDraft returns only the owning consumer’s draft and never another tenant’s', () => {
  const owned = findOwnedResumeDraft({
    principal: PRINCIPAL,
    drafts: [draft({draftId: 'other-draft', companyId: 'company-2', consumerSubject: 'consumer-2'}), draft()],
  });
  assert.equal(owned?.draftId, 'draft-1');
  assert.equal(findOwnedResumeDraft({principal: PRINCIPAL, drafts: [draft({companyId: 'company-2'})]}), null);
  assert.equal(findOwnedResumeDraft({principal: PRINCIPAL, drafts: []}), null);
});

test('pre-expiry warning fires only in the final 2 minutes, with factual text and no pressure', () => {
  assert.equal(MUSE_DRAFT_EXPIRY_WARNING_MS, 2 * 60 * 1000);
  // 9 minutes out: comfortably unexpired, no warning.
  assert.equal(draftExpiryWarning({draft: draft(), now: NOW}), null);
  // 90 seconds out: in the window.
  const warning = draftExpiryWarning({draft: draft({expiresAt: '2026-10-27T12:01:30.000Z'}), now: NOW});
  assert.ok(warning);
  assert.equal(warning?.kind, 'expiry_warning');
  assert.match(warning?.text ?? '', /expires at 2026-10-27T12:01:30\.000Z/);
  assert.match(warning?.text ?? '', /\$277 USD/);
  assert.match(warning?.text ?? '', /review the updated total and approve again/);
  assert.match(warning?.text ?? '', /Nothing will be charged automatically/);
  assert.doesNotMatch(warning?.text ?? '', /hurry|countdown|last chance/i);
  // Exactly at expiry and past expiry: no warning (the draft is dead, not "near expiry").
  assert.equal(draftExpiryWarning({draft: draft({expiresAt: NOW}), now: NOW}), null);
  assert.equal(draftExpiryWarning({draft: draft({expiresAt: PAST_EXPIRY}), now: NOW}), null);
  assert.equal(isDraftExpired(PAST_EXPIRY, NOW), true);
  assert.equal(isDraftExpired(FRESH_EXPIRY, NOW), false);
});

test('review diff names old and new values in words and is empty when nothing changed', () => {
  const diff = buildReviewDiff({oldDraft: draft(), newDraft: draft({total: '285', shippingAmount: '16', taxAmount: '22'})});
  assert.equal(diff.changed, true);
  assert.match(diff.text, /Total changed from \$277 USD to \$285 USD/);
  assert.match(diff.text, /Shipping changed/);
  assert.match(diff.text, /Tax changed/);
  assert.equal(buildReviewDiff({oldDraft: draft(), newDraft: draft()}).changed, false);
  assert.equal(buildReviewDiff({oldDraft: draft(), newDraft: draft()}).text, '');
});

test('expired reminder records are dead and eligible for deletion, with no scheduler added', () => {
  const dead = purgeEligibleReminderRecords({
    records: [
      {draftId: 'draft-1', draftExpiresAt: PAST_EXPIRY},
      {draftId: 'draft-2', draftExpiresAt: FRESH_EXPIRY},
    ],
    now: NOW,
  });
  assert.deepEqual(dead.map((record) => record.draftId), ['draft-1']);
});
