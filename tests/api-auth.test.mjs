import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {authenticateRequest,authenticateRequestWithAuthority,parseApiKeyRegistry} from '../apps/api/dist/auth.js';

const h=x=>createHash('sha256').update(x).digest('hex');

test('production registry stores only credential IDs and hashes',()=>{
 const registry=parseApiKeyRegistry(`org-a:key-1:${h('secret-a')}:recommend_gifts|build_bundle`,{allowPlaintext:false});
 assert.equal(registry.get('org-a').credentialId,'key-1');
 assert.equal(registry.get('org-a').secretHash,h('secret-a'));
 assert.equal('secret' in registry.get('org-a'),false);
 assert.deepEqual(registry.get('org-a').capabilities,['recommend_gifts','build_bundle']);
});

test('plaintext registry entries are rejected in production mode',()=>{
 const registry=parseApiKeyRegistry('org-a:secret-a:recommend_gifts',{allowPlaintext:false});
 assert.equal(registry.size,0);
});

test('agent API authentication requires matching org and hashed key',()=>{
 const raw=`org-a:key-1:${h('secret-a')}:recommend_gifts|build_bundle,org-b:key-2:${h('secret-b')}:record_telemetry`;
 const valid=authenticateRequest({headers:{'x-org-id':'org-a','x-api-key':'secret-a','x-request-id':'req-123'}},raw,{allowPlaintext:false});
 assert.deepEqual(valid,{orgId:'org-a',requestId:'req-123',credentialId:'key-1',capabilities:['recommend_gifts','build_bundle']});
 assert.equal(authenticateRequest({headers:{'x-org-id':'org-a','x-api-key':'wrong'}},raw,{allowPlaintext:false}),null);
 assert.equal(authenticateRequest({headers:{'x-api-key':'secret-a'}},raw,{allowPlaintext:false}),null);
});

test('legacy plaintext is allowed only when explicitly enabled for development',()=>{
 const valid=authenticateRequest({headers:{'x-org-id':'org-a','x-api-key':'secret-a'}},'org-a:secret-a:recommend_gifts',{allowPlaintext:true});
 assert.equal(valid?.credentialId,'legacy-dev');
});

test('request IDs are bounded and generated when absent',()=>{
 const raw=`org-a:key-1:${h('secret-a')}:recommend_gifts`;
 const generated=authenticateRequest({headers:{'x-org-id':'org-a','x-api-key':'secret-a'}},raw,{allowPlaintext:false});
 assert.equal(generated?.orgId,'org-a');
 assert.ok((generated?.requestId.length??0)>0);
 const long='x'.repeat(300);
 const bounded=authenticateRequest({headers:{'x-org-id':'org-a','x-api-key':'secret-a','x-request-id':long}},raw,{allowPlaintext:false});
 assert.equal(bounded?.requestId.length,128);
});

test('persistent credential authority propagates explicit owner role',async()=>{
 const authority={
  async resolve(orgId,credentialId){
   assert.equal(orgId,'org-a');
   assert.equal(credentialId,'owner-key');
   return {
    credentialId:'owner-key',
    secretHash:h('owner-secret'),
    capabilities:['admin_override'],
    roles:['owner']
   };
  }
 };
 const principal=await authenticateRequestWithAuthority({
  headers:{'x-org-id':'org-a','x-credential-id':'owner-key','x-api-key':'owner-secret'}
 },authority);
 assert.deepEqual(principal?.roles,['owner']);
 assert.deepEqual(principal?.capabilities,['admin_override']);
});
