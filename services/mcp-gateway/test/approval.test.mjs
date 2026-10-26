import test from 'node:test';
import assert from 'node:assert/strict';
import {signDraft} from '../../../packages/zero-trust/dist/index.js';
import {HumanApprovalIssuer} from '../dist/business-approval.js';

const connection={connectionId:'conn',companyId:'co',subjectId:'user',grantedActions:['execute_action'],secretRef:'server-only',createdAt:'2026-10-24T16:00:00Z',expiresAt:'2026-10-25T00:00:00Z'};
const draft={draftId:'d1',companyId:'co',connectionId:'conn',kind:'PURCHASE',offerIds:['o'],quantity:1,total:50,currency:'USD',summary:'item',createdAt:'2026-10-24T16:00:00Z',expiresAt:'2026-10-24T17:00:00Z',approvalRequired:true,liveRevalidationRequired:true};
const env=signDraft(draft,'draft-secret','2026-10-24T16:00:00Z');

test('approval issuer requires recently authenticated matching human and displayed hash',async()=>{
  const issuer=new HumanApprovalIssuer({async get(){return env;}},{async resolve(){return connection;}},'approval-secret');
  const token=await issuer.issue({identity:{subjectId:'user',sessionId:'s',authenticatedAt:'2026-10-24T16:05:00Z',assurance:'PASSKEY'},connectionId:'conn',draftId:'d1',displayedDraftHash:env.payloadHash,approved:true,now:new Date('2026-10-24T16:10:00Z')});
  assert.match(token,/\./);
});

test('model cannot approve for another user or unseen draft hash',async()=>{
  const issuer=new HumanApprovalIssuer({async get(){return env;}},{async resolve(){return connection;}},'approval-secret');
  await assert.rejects(()=>issuer.issue({identity:{subjectId:'attacker',sessionId:'s',authenticatedAt:'2026-10-24T16:05:00Z',assurance:'OAUTH_VERIFIED'},connectionId:'conn',draftId:'d1',displayedDraftHash:env.payloadHash,approved:true,now:new Date('2026-10-24T16:10:00Z')}),/approval_identity_mismatch/);
  await assert.rejects(()=>issuer.issue({identity:{subjectId:'user',sessionId:'s',authenticatedAt:'2026-10-24T16:05:00Z',assurance:'MFA'},connectionId:'conn',draftId:'d1',displayedDraftHash:'forged',approved:true,now:new Date('2026-10-24T16:10:00Z')}),/displayed_draft_hash_mismatch/);
});
