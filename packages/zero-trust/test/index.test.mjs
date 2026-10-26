import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryReplayStore,
  digestObject,
  signDraft,
  verifyDraft,
  issueApprovalToken,
  verifyAndConsumeApproval,
  consumeWebhookOnce
} from '../dist/index.js';

const draft={draftId:'d1',companyId:'c1',connectionId:'conn1',subjectId:'u1',total:250,currency:'USD',expiresAt:'2026-10-24T17:00:00.000Z'};

test('signed drafts detect caller tampering',()=>{
  const env=signDraft(draft,'draft-secret','2026-10-24T16:00:00.000Z');
  assert.equal(verifyDraft(env,'draft-secret',new Date('2026-10-24T16:10:00Z')).ok,true);
  env.payload.total=1;
  assert.equal(verifyDraft(env,'draft-secret',new Date('2026-10-24T16:10:00Z')).ok,false);
});

test('approval is bound to exact draft amount identity and is one-time',async()=>{
  const replay=new InMemoryReplayStore();
  const hash=digestObject(draft);
  const token=issueApprovalToken({
    subjectId:'u1',companyId:'c1',connectionId:'conn1',draftId:'d1',draftHash:hash,amount:250,currency:'USD',expiresAt:'2026-10-24T16:30:00Z'
  },'approval-secret','2026-10-24T16:00:00Z');
  const expected={subjectId:'u1',companyId:'c1',connectionId:'conn1',draftId:'d1',draftHash:hash,amount:250,currency:'USD'};
  assert.equal((await verifyAndConsumeApproval({token,secret:'approval-secret',replay,expected,now:new Date('2026-10-24T16:10:00Z')})).ok,true);
  assert.equal((await verifyAndConsumeApproval({token,secret:'approval-secret',replay,expected,now:new Date('2026-10-24T16:11:00Z')})).reason,'approval_replayed');
});

test('approval cannot be reused with changed amount',async()=>{
  const replay=new InMemoryReplayStore();
  const hash=digestObject(draft);
  const token=issueApprovalToken({
    subjectId:'u1',companyId:'c1',connectionId:'conn1',draftId:'d1',draftHash:hash,amount:250,currency:'USD',expiresAt:'2026-10-24T16:30:00Z'
  },'approval-secret','2026-10-24T16:00:00Z');
  const result=await verifyAndConsumeApproval({token,secret:'approval-secret',replay,expected:{subjectId:'u1',companyId:'c1',connectionId:'conn1',draftId:'d1',draftHash:hash,amount:249,currency:'USD'},now:new Date('2026-10-24T16:10:00Z')});
  assert.equal(result.reason,'approval_amount_mismatch');
});

test('webhook IDs are consumed once',async()=>{
  const replay=new InMemoryReplayStore();
  assert.equal(await consumeWebhookOnce({provider:'stripe',eventId:'evt_1',expiresAt:'2026-10-25T00:00:00Z',replay}),true);
  assert.equal(await consumeWebhookOnce({provider:'stripe',eventId:'evt_1',expiresAt:'2026-10-25T00:00:00Z',replay}),false);
});
