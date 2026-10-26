import test from 'node:test';
import assert from 'node:assert/strict';
import {HumanApprovalIssuer} from '@gift-signal/mcp-gateway';
import {signDraft,verifyApproval} from '@gift-signal/zero-trust';
import {issueVerifiedHumanApproval,approvalErrorStatus} from '../dist/approval.js';

function fixture(){
  const now=new Date().toISOString();
  const expiresAt=new Date(Date.now()+600000).toISOString();
  const identity={subjectId:'buyer',sessionId:'session',authenticatedAt:now,assurance:'PASSKEY' as const};
  const connection={connectionId:'conn',companyId:'company',subjectId:'buyer',secretRef:'server-only',createdAt:now,grantedActions:['execute_action' as const]};
  const draft={draftId:'draft',connectionId:'conn',companyId:'company',kind:'BOOKING' as const,offerIds:['offer'],quantity:1,total:50,currency:'USD',summary:'booking',createdAt:now,expiresAt,approvalRequired:true as const,liveRevalidationRequired:true as const};
  const envelope=signDraft(draft,'draft-secret',now);
  const issuer=new HumanApprovalIssuer({get:async()=>envelope},{resolve:async()=>connection},'approval-secret');
  const body={connectionId:'conn',draftId:'draft',displayedDraftHash:envelope.payloadHash,approved:true};
  const expected={subjectId:'buyer',companyId:'company',connectionId:'conn',draftId:'draft',draftHash:envelope.payloadHash,amount:50,currency:'USD'};
  return {identity,issuer,body,expected};
}
test('generic booking approval works without Shop identity or any payment store',async()=>{
  const f=fixture();
  const result=await issueVerifiedHumanApproval(f);
  const verified=verifyApproval({token:result.approvalToken,secret:'approval-secret',expected:f.expected});
  assert.equal(verified.ok,true);
  if(verified.ok) assert.equal(verified.claims.paymentAuthorizationReference,undefined);
  const muse=verifyApproval({token:result.approvalToken,secret:'approval-secret',expected:{...f.expected,paymentAuthorizationReference:'seti_saved'}});
  assert.deepEqual(muse,{ok:false,reason:'approval_payment_authorization_mismatch'});
});
test('Muse approval binds only the verified subjects server-resolved payment',async()=>{
  const f=fixture();let subject:string|undefined;
  const result=await issueVerifiedHumanApproval({...f,
    body:{...f.body,paymentAuthorizationReference:'attacker',customerId:'cus_attacker',paymentMethodId:'pm_attacker'} as any,
    resolveSavedPayment:async(id)=>{subject=id;return {reference:'seti_owned'};}
  });
  assert.equal(subject,'buyer');
  assert.equal(verifyApproval({token:result.approvalToken,secret:'approval-secret',expected:{...f.expected,paymentAuthorizationReference:'seti_owned'}}).ok,true);
  assert.equal(verifyApproval({token:result.approvalToken,secret:'approval-secret',expected:{...f.expected,paymentAuthorizationReference:'attacker'}}).ok,false);
});
test('generic approval ignores browser-selected authorization and resolver fields',async()=>{
  const f=fixture();
  const result=await issueVerifiedHumanApproval({...f,body:{...f.body,paymentAuthorizationReference:'attacker',resolveSavedPayment:'attacker'} as any});
  const verified=verifyApproval({token:result.approvalToken,secret:'approval-secret',expected:f.expected});
  assert.equal(verified.ok,true);
  if(verified.ok) assert.equal(verified.claims.paymentAuthorizationReference,undefined);
});
test('Muse enrollment requirement fails before signing when payment is absent',async()=>{
  const f=fixture();let signed=false;
  await assert.rejects(issueVerifiedHumanApproval({...f,resolveSavedPayment:async()=>null,
    issuer:{issue:async()=>{signed=true;throw Error('must_not_sign');}}}),/consumer_commerce_enrollment_required/);
  assert.equal(signed,false);
});
test('generic and Muse approvals preserve explicit Buy, identity and exact draft checks',async()=>{
  for(const purchase of [false,true]){
    const f=fixture();const options=purchase?{resolveSavedPayment:async()=>({reference:'seti_saved'})}:{};
    await assert.rejects(issueVerifiedHumanApproval({...f,...options,body:{...f.body,approved:false}}),/explicit_approval_required/);
    await assert.rejects(issueVerifiedHumanApproval({...f,...options,identity:{...f.identity,subjectId:'attacker'}}),/approval_identity_mismatch/);
    await assert.rejects(issueVerifiedHumanApproval({...f,...options,body:{...f.body,displayedDraftHash:'b'.repeat(64)}}),/displayed_draft_hash_mismatch/);
  }
});
test('approval errors distinguish missing enrollment, missing consent and authentication',()=>{
  assert.equal(approvalErrorStatus('consumer_commerce_enrollment_required'),409);
  assert.equal(approvalErrorStatus('explicit_approval_required'),400);
  assert.equal(approvalErrorStatus('provider_checkout_reapproval_required'),409);
  assert.equal(approvalErrorStatus('approval_payment_authorization_mismatch'),409);
  assert.equal(approvalErrorStatus('identity_token_required'),401);
  assert.equal(approvalErrorStatus('identity_token_invalid'),401);
  assert.equal(approvalErrorStatus('user_reauthentication_required'),401);
  assert.equal(approvalErrorStatus('consumer_commerce_identity_store_not_configured'),503);
});
