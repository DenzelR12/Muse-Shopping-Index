import {promoteVerifiedShopifyWebhookEvidence} from '../dist/provider-webhooks.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderReadinessService} from '../dist/provider-readiness-service.js';

function fakeConnections(){
  const rows=new Map();
  return {
    set(row){rows.set([row.companyId,row.provider,row.externalAccountId].join('|'),row);},
    async get(companyId,provider,externalAccountId){
      return rows.get([companyId,provider,externalAccountId].join('|'))??null;
    }
  };
}

function fakeEvidence(){
  const rows=new Map();
  return {
    set(row){rows.set([row.companyId,row.provider,row.externalAccountId].join('|'),row);},
    async get(companyId,provider,externalAccountId){
      return rows.get([companyId,provider,externalAccountId].join('|'))??null;
    }
  };
}

test('readiness service is tenant scoped',async()=>{
  const connections=fakeConnections();
  const evidence=fakeEvidence();
  connections.set({
    companyId:'org-a',
    provider:'walmart',
    externalAccountId:'seller-1',
    grantedCapabilities:['catalog.read']
  });
  evidence.set({
    companyId:'org-a',
    provider:'walmart',
    externalAccountId:'seller-1',
    identityVerified:true,
    metaBusinessVerified:true,
    catalogValidated:true,
    webhookEvents:false,
    idempotency:false,
    providerRevalidation:false,
    agentPolicyConfigured:false,
    auditTrail:false,
    recoveryActions:false,
    fulfillmentStatus:false
  });
  const service=new ProviderReadinessService(connections,evidence);
  await assert.rejects(
    service.evaluate({companyId:'org-b',provider:'walmart',externalAccountId:'seller-1'}),
    /provider_connection_not_found/
  );
});

test('readiness advances only when stored evidence and granted capabilities support it',async()=>{
  const connections=fakeConnections();
  const evidence=fakeEvidence();
  connections.set({
    companyId:'org-a',
    provider:'walmart',
    externalAccountId:'seller-1',
    grantedCapabilities:['catalog.read','inventory.read','pricing.read','order.create','fulfillment.read']
  });
  evidence.set({
    companyId:'org-a',
    provider:'walmart',
    externalAccountId:'seller-1',
    identityVerified:true,
    metaBusinessVerified:true,
    catalogValidated:true,
    webhookEvents:true,
    idempotency:true,
    providerRevalidation:true,
    agentPolicyConfigured:false,
    auditTrail:false,
    recoveryActions:false,
    fulfillmentStatus:true
  });
  const service=new ProviderReadinessService(connections,evidence);
  const manifest=await service.evaluate({companyId:'org-a',provider:'walmart',externalAccountId:'seller-1'});
  assert.equal(manifest.readiness,'TRANSACTION_READY');
});

test('missing stored evidence blocks readiness evaluation',async()=>{
  const connections=fakeConnections();
  const evidence=fakeEvidence();
  connections.set({
    companyId:'org-a',
    provider:'etsy',
    externalAccountId:'shop-1',
    grantedCapabilities:['catalog.read']
  });
  const service=new ProviderReadinessService(connections,evidence);
  await assert.rejects(
    service.evaluate({companyId:'org-a',provider:'etsy',externalAccountId:'shop-1'}),
    /provider_readiness_evidence_not_found/
  );
});

test('verified Shopify webhook evidence promotes only a unique active connection',async()=>{
  const calls=[];
  const evidence={
    async markTrusted(key,patch){
      calls.push({key,patch});
    }
  };
  const uniquePool={
    async query(){
      return {rows:[{company_id:'org-a',external_account_id:'shop.example.com'}]};
    }
  };
  const result=await promoteVerifiedShopifyWebhookEvidence('shop.example.com',{pool:uniquePool,evidence});
  assert.deepEqual(result,{
    promoted:true,
    companyId:'org-a',
    externalAccountId:'shop.example.com'
  });
  assert.deepEqual(calls,[{
    key:{companyId:'org-a',provider:'shopify',externalAccountId:'shop.example.com'},
    patch:{webhookEvents:true,idempotency:true}
  }]);
});

test('Shopify webhook readiness fails closed when connection mapping is ambiguous',async()=>{
  const calls=[];
  const evidence={async markTrusted(...args){calls.push(args);}};
  const ambiguousPool={
    async query(){
      return {rows:[
        {company_id:'org-a',external_account_id:'shop.example.com'},
        {company_id:'org-b',external_account_id:'shop.example.com'}
      ]};
    }
  };
  const result=await promoteVerifiedShopifyWebhookEvidence('shop.example.com',{pool:ambiguousPool,evidence});
  assert.deepEqual(result,{promoted:false,reason:'connection_ambiguous'});
  assert.equal(calls.length,0);
});

test('readiness derives agent policy from current persisted policy',async()=>{
  const connections=fakeConnections();
  const evidence=fakeEvidence();
  connections.set({
    companyId:'org-a',
    provider:'walmart',
    externalAccountId:'seller-1',
    grantedCapabilities:['catalog.read','inventory.read','pricing.read','order.create','fulfillment.read']
  });
  evidence.set({
    companyId:'org-a',
    provider:'walmart',
    externalAccountId:'seller-1',
    identityVerified:true,
    metaBusinessVerified:true,
    catalogValidated:true,
    webhookEvents:true,
    idempotency:true,
    providerRevalidation:true,
    agentPolicyConfigured:false,
    auditTrail:true,
    recoveryActions:true,
    fulfillmentStatus:true
  });
  const policies={
    async get(companyId,provider,externalAccountId){
      assert.deepEqual([companyId,provider,externalAccountId],['org-a','walmart','seller-1']);
      return {
        companyId,provider,externalAccountId,
        allowedAgents:['muse','enterprise-agent'],
        maxOrderAmount:2500,
        currency:'USD',
        updatedAt:'2026-10-24T20:00:00Z'
      };
    }
  };
  const agents={async requireActive(){return [];}};
  const service=new ProviderReadinessService(connections,evidence,policies,agents);
  const manifest=await service.evaluate({companyId:'org-a',provider:'walmart',externalAccountId:'seller-1'});
  assert.equal(manifest.readiness,'AUTONOMOUS_READY');
  assert.deepEqual(manifest.agentPolicy.allowedAgents,['muse','enterprise-agent']);
  assert.equal(manifest.agentPolicy.maxOrderAmount,2500);
  assert.equal(manifest.agentPolicy.currency,'USD');
});

test('revoked policy agents fail agent-policy readiness closed',async()=>{
  const connections={async get(){return {companyId:'org-a',provider:'shopify',externalAccountId:'shop',grantedCapabilities:['catalog.read','inventory.read','pricing.read','order.create','fulfillment.read']};}};
  const evidence={async get(){return {
    identityVerified:true,metaBusinessVerified:true,catalogValidated:true,webhookEvents:true,idempotency:true,
    providerRevalidation:true,agentPolicyConfigured:false,auditTrail:true,recoveryActions:true,
    fulfillmentStatus:true
  };}};
  const policies={async get(){return {
    companyId:'org-a',provider:'shopify',externalAccountId:'shop',
    allowedAgents:['agent-a'],maxOrderAmount:100,currency:'USD',updatedAt:'2026-10-24T00:00:00Z'
  };}};
  const agents={async requireActive(){return ['agent-a'];}};
  const service=new ProviderReadinessService(connections,evidence,policies,agents);
  const manifest=await service.evaluate({companyId:'org-a',provider:'shopify',externalAccountId:'shop'});
  assert.equal(manifest.readiness,'TRANSACTION_READY');
  assert.deepEqual(manifest.agentPolicy,{
    allowedAgents:[],
    maxOrderAmount:undefined,
    currency:undefined,
    humanApprovalRequiredForCommit:true
  });
});
