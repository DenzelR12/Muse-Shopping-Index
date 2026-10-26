import test from 'node:test';
import assert from 'node:assert/strict';
import {audit,appendAuditRecord,verifyAuditChain} from '../dist/index.js';

test('audit chain is tamper evident',()=>{
 const r1=appendAuditRecord({event:audit('approval_issued',{draftId:'d1'},{id:'e1',at:'2026-10-24T16:00:00Z'}),sequence:1,previousHash:'GENESIS',signingSecret:'audit-secret'});
 const r2=appendAuditRecord({event:audit('draft_executed',{draftId:'d1'},{id:'e2',at:'2026-10-24T16:01:00Z'}),sequence:2,previousHash:r1.eventHash,signingSecret:'audit-secret'});
 assert.equal(verifyAuditChain([r1,r2],'audit-secret').ok,true);
 r1.payload.draftId='forged';
 assert.equal(verifyAuditChain([r1,r2],'audit-secret').ok,false);
});

test('chain rejects deletion/reordering',()=>{
 const r1=appendAuditRecord({event:audit('a',{}, {id:'a',at:'2026-10-24T16:00:00Z'}),sequence:1,previousHash:'GENESIS',signingSecret:'s'});
 const r2=appendAuditRecord({event:audit('b',{}, {id:'b',at:'2026-10-24T16:01:00Z'}),sequence:2,previousHash:r1.eventHash,signingSecret:'s'});
 assert.equal(verifyAuditChain([r2],'s').ok,false);
});
