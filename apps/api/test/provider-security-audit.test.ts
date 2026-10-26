import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderSecurityAuditor,assertSafeProviderAuditMetadata} from '../dist/provider-security-audit.js';

test('provider auditor rejects secret-like fields',()=>{
  assert.throws(
    ()=>assertSafeProviderAuditMetadata({
      companyId:'org-a',
      provider:'etsy',
      accessToken:'secret'
    }),
    /provider_audit_secret_field_rejected/
  );
});

test('provider auditor rejects secret-like values',()=>{
  assert.throws(
    ()=>assertSafeProviderAuditMetadata({
      companyId:'org-a',
      provider:'etsy',
      externalAccountId:'Bearer abc123'
    }),
    /provider_audit_secret_value_rejected/
  );
});

test('provider auditor emits only safe metadata',async()=>{
  let seen;
  const sink={
    async publish(streamId,type,payload,meta){
      seen={streamId,type,payload,meta};
      return {id:'evt-1'};
    }
  };
  const auditor=new ProviderSecurityAuditor(sink);
  await auditor.record('provider.sync.succeeded',{
    companyId:'org-a',
    provider:'ebay',
    externalAccountId:'seller-1',
    syncKind:'inventory',
    itemCount:12,
    requestId:'req-1'
  });
  assert.equal(seen.streamId,'provider:org-a');
  assert.equal(seen.type,'provider.sync.succeeded');
  assert.deepEqual(seen.payload,{
    companyId:'org-a',
    provider:'ebay',
    externalAccountId:'seller-1',
    syncKind:'inventory',
    itemCount:12,
    requestId:'req-1'
  });
});

test('runtime control emits lifecycle audit events without credentials',async()=>{
  const events=[];
  const auditor={async record(type,metadata){events.push({type,metadata});}};
  const connections={
    async get(){return {provider:'ebay'};},
    async markSyncSuccess(){return {provider:'ebay'};},
    async markSyncError(){return {provider:'ebay'};},
    async updateTokenExpiry(){return {provider:'ebay'};},
    async revoke(){return {provider:'ebay',revokedAt:'now'};}
  };
  const runtime={
    async refresh(){return {expiresAt:'2099-01-01T00:00:00Z'};},
    async sync(){return [{provider:'ebay',externalId:'1',raw:{}}];},
    async revoke(){return {credentialRevoked:true,upstream:'revoked'};}
  };
  const {ProviderRuntimeControlPlane}=await import('../dist/provider-runtime-control.js');
  const control=new ProviderRuntimeControlPlane(runtime,connections,auditor);
  const key={companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'};
  await control.refresh(key);
  await control.sync(key,{kind:'inventory'});
  await control.revoke(key);
  assert.deepEqual(events.map(x=>x.type),[
    'provider.credential.refreshed',
    'provider.sync.succeeded',
    'provider.connection.revoked'
  ]);
  assert.ok(events.every(x=>!Object.keys(x.metadata).some(k=>/token|secret|credential/i.test(k))));
});

test('sync failure audit uses bounded code instead of raw provider message',async()=>{
  const events=[];
  const auditor={async record(type,metadata){events.push({type,metadata});}};
  const connections={
    async get(){return {provider:'ebay'};},
    async markSyncSuccess(){return {provider:'ebay'};},
    async markSyncError(_c,_p,_a,error){return {provider:'ebay',lastSyncError:error};},
    async updateTokenExpiry(){return {provider:'ebay'};},
    async revoke(){return {provider:'ebay'};}
  };
  const runtime={
    async sync(){throw new Error('Bearer secret-token leaked by upstream');}
  };
  const {ProviderRuntimeControlPlane}=await import('../dist/provider-runtime-control.js');
  const control=new ProviderRuntimeControlPlane(runtime,connections,auditor);
  await assert.rejects(
    control.sync({companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},{kind:'inventory'}),
    /Bearer secret-token/
  );
  assert.equal(events[0].type,'provider.sync.failed');
  assert.equal(events[0].metadata.errorCode,'provider_sync_failed');
});

test('OAuth callback fails closed on missing audit sink before completing authorization',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const callbackStart=source.indexOf("if(url.pathname==='/v1/provider-oauth/callback')");
  const auditGuard=source.indexOf("if(!providerAuditReady) return send(res,503,{error:'provider_audit_not_configured'},requestId);",callbackStart);
  const complete=source.indexOf("providerOAuth.complete({state,code",callbackStart);
  assert.ok(callbackStart>=0);
  assert.ok(auditGuard>callbackStart);
  assert.ok(complete>auditGuard);
});

test('destructive provider routes require admin_override before mutation',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');

  const batch=source.indexOf("if(req.method==='POST'&&req.url==='/v1/provider-credentials/rekey-batch')");
  const batchGuard=source.indexOf("if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);",batch);
  const batchMutation=source.indexOf("providerRuntimeControl.rekeyBatch(principal.orgId,limit)",batch);
  assert.ok(batch>=0&&batchGuard>batch&&batchMutation>batchGuard);

  const rekey=source.indexOf("if(action==='rekey')");
  const rekeyGuard=source.indexOf("if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);",rekey);
  const rekeyMutation=source.indexOf("providerRuntimeControl.rekey(key)",rekey);
  assert.ok(rekey>=0&&rekeyGuard>rekey&&rekeyMutation>rekeyGuard);

  const revokeMutation=source.indexOf("providerRuntimeControl.revoke(key)");
  const revokeGuard=source.lastIndexOf("if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);",revokeMutation);
  assert.ok(revokeMutation>=0&&revokeGuard>=0&&revokeGuard<revokeMutation);
});

test('provider capability grants require admin authority and audit before persistence',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("if(req.method==='POST'&&req.url==='/v1/provider-connections')");
  const adminGuard=source.indexOf("if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);",route);
  const auditGuard=source.indexOf("if(!providerAuditReady) return send(res,503,{error:'provider_audit_not_configured'},principal.requestId);",route);
  const mutation=source.indexOf("providerConnections.upsert({",route);
  const auditEvent=source.indexOf("provider.connection.capabilities_updated",mutation);
  assert.ok(route>=0);
  assert.ok(adminGuard>route&&adminGuard<mutation);
  assert.ok(auditGuard>adminGuard&&auditGuard<mutation);
  assert.ok(auditEvent>mutation);
});

test('provider agent policy writes require admin authority and audit before persistence',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("const policyMatch=req.url?.match(/^\\/v1\\/provider-agent-policy");
  const put=source.indexOf("if(req.method==='PUT')",route);
  const adminGuard=source.indexOf("if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);",put);
  const auditGuard=source.indexOf("if(!providerAuditReady) return send(res,503,{error:'provider_audit_not_configured'},principal.requestId);",put);
  const mutation=source.indexOf("providerAgentPolicies.upsert({",put);
  const auditEvent=source.indexOf("provider.agent_policy.updated",mutation);
  assert.ok(route>=0&&put>route);
  assert.ok(adminGuard>put&&adminGuard<mutation);
  assert.ok(auditGuard>adminGuard&&auditGuard<mutation);
  assert.ok(auditEvent>mutation);
});

test('high-risk capability checks use authenticated principal roles',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const helper=source.indexOf('const requireCapability=');
  const roleUse=source.indexOf('roles:principal.roles??[]',helper);
  const hardcodedEmpty=source.indexOf('roles:[]',helper);
  assert.ok(helper>=0);
  assert.ok(roleUse>helper);
  assert.equal(hardcodedEmpty,-1);
});

test('provider lifecycle mutations require manage_provider_connections capability',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const guard="if(!requireCapability(principal,'manage_provider_connections')) return send(res,403,{error:'forbidden'},principal.requestId);";

  const oauth=source.indexOf("if(req.method==='POST'&&req.url==='/v1/provider-oauth/start')");
  const oauthGuard=source.indexOf(guard,oauth);
  const oauthMutation=source.indexOf('providerOAuth.begin({',oauth);
  assert.ok(oauth>=0&&oauthGuard>oauth&&oauthMutation>oauthGuard);

  const refresh=source.indexOf("if(action==='refresh')");
  const refreshGuard=source.indexOf(guard,refresh);
  const refreshMutation=source.indexOf('providerRuntimeControl.refresh(key)',refresh);
  assert.ok(refresh>=0&&refreshGuard>refresh&&refreshMutation>refreshGuard);

  const sync=source.indexOf("if(action==='sync')");
  const syncGuard=source.indexOf(guard,sync);
  const syncMutation=source.indexOf('providerRuntimeControl.sync(key,{',sync);
  assert.ok(sync>=0&&syncGuard>sync&&syncMutation>syncGuard);
});

test('provider agent policy validation rejects type coercion',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("const policyMatch=req.url?.match(/^\\/v1\\/provider-agent-policy");
  const put=source.indexOf("if(req.method==='PUT')",route);
  const agentTypeGuard=source.indexOf("payload.allowedAgents.some(value=>typeof value!=='string')",put);
  const amountTypeGuard=source.indexOf("typeof payload.maxOrderAmount!=='number'",put);
  const currencyTypeGuard=source.indexOf("typeof payload.currency!=='string'",put);
  const agentCoercion=source.indexOf("String(value).trim()",put);
  const amountCoercion=source.indexOf("Number(payload.maxOrderAmount)",put);
  const currencyCoercion=source.indexOf("String(payload.currency",put);
  assert.ok(agentTypeGuard>put);
  assert.ok(amountTypeGuard>put);
  assert.ok(currencyTypeGuard>put);
  assert.equal(agentCoercion,-1);
  assert.equal(amountCoercion,-1);
  assert.equal(currencyCoercion,-1);
});

test('reauthorization clears stale readiness before activating the connection',async()=>{
  let activated=false;
  const connections={
    async reconcileAuthorization(){
      activated=true;
      return {provider:'ebay'};
    }
  };
  const readiness={
    async resetAuthorizationEpoch(){
      throw new Error('readiness_reset_failed');
    }
  };
  const {ProviderRuntimeControlPlane}=await import('../dist/provider-runtime-control.js');
  const control=new ProviderRuntimeControlPlane({},connections,undefined,readiness);
  await assert.rejects(
    control.reconcileAuthorization({
      companyId:'org-a',
      provider:'ebay',
      externalAccountId:'seller-1',
      expiresAt:'2099-01-01T00:00:00Z'
    }),
    /readiness_reset_failed/
  );
  assert.equal(activated,false);
});

test('verified Shopify fulfillment webhook promotes fulfillment readiness only with fulfillment.read',async()=>{
  const patches=[];
  const pool={
    async query(){
      return {rows:[{
        company_id:'org-a',
        external_account_id:'shop.example',
        granted_capabilities:['catalog.read','fulfillment.read']
      }]};
    }
  };
  const evidence={async markTrusted(_key,patch){patches.push(patch);}};
  const {promoteVerifiedShopifyWebhookEvidence}=await import('../dist/provider-webhooks.js');
  const result=await promoteVerifiedShopifyWebhookEvidence('shop.example',{
    topic:'fulfillments/update',
    pool,
    evidence
  });
  assert.equal(result.promoted,true);
  assert.equal(result.fulfillmentStatus,true);
  assert.deepEqual(patches[0],{webhookEvents:true,idempotency:true,fulfillmentStatus:true});
});

test('Shopify non-fulfillment webhook does not promote fulfillment readiness',async()=>{
  const patches=[];
  const pool={
    async query(){
      return {rows:[{
        company_id:'org-a',
        external_account_id:'shop.example',
        granted_capabilities:['fulfillment.read']
      }]};
    }
  };
  const evidence={async markTrusted(_key,patch){patches.push(patch);}};
  const {promoteVerifiedShopifyWebhookEvidence}=await import('../dist/provider-webhooks.js');
  const result=await promoteVerifiedShopifyWebhookEvidence('shop.example',{
    topic:'products/update',
    pool,
    evidence
  });
  assert.equal(result.promoted,true);
  assert.equal(result.fulfillmentStatus,undefined);
  assert.deepEqual(patches[0],{webhookEvents:true,idempotency:true});
});

test('Shopify fulfillment webhook without fulfillment.read remains fail closed',async()=>{
  const patches=[];
  const pool={
    async query(){
      return {rows:[{
        company_id:'org-a',
        external_account_id:'shop.example',
        granted_capabilities:['catalog.read']
      }]};
    }
  };
  const evidence={async markTrusted(_key,patch){patches.push(patch);}};
  const {promoteVerifiedShopifyWebhookEvidence}=await import('../dist/provider-webhooks.js');
  const result=await promoteVerifiedShopifyWebhookEvidence('shop.example',{
    topic:'fulfillments/create',
    pool,
    evidence
  });
  assert.equal(result.promoted,true);
  assert.equal(result.fulfillmentStatus,undefined);
  assert.deepEqual(patches[0],{webhookEvents:true,idempotency:true});
});

test('provider control-plane reads require manage_provider_connections capability',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const guard="if(!requireCapability(principal,'manage_provider_connections')) return send(res,403,{error:'forbidden'},principal.requestId);";

  const policyRoute=source.indexOf("const policyMatch=req.url?.match(/^\\/v1\\/provider-agent-policy");
  const policyGet=source.indexOf("if(req.method==='GET')",policyRoute);
  const policyGuard=source.indexOf(guard,policyGet);
  const policyRead=source.indexOf("providerAgentPolicies.get",policyGet);
  assert.ok(policyRoute>=0&&policyGet>policyRoute&&policyGuard>policyGet&&policyRead>policyGuard);

  const readinessRoute=source.indexOf("const readinessMatch=req.url?.match(/^\\/v1\\/provider-readiness");
  const readinessGet=source.indexOf("if(req.method==='GET')",readinessRoute);
  const readinessGuard=source.indexOf(guard,readinessGet);
  const readinessRead=source.indexOf("providerReadinessEvidence.get",readinessGet);
  assert.ok(readinessRoute>=0&&readinessGet>readinessRoute&&readinessGuard>readinessGet&&readinessRead>readinessGuard);

  const connectionsGet=source.indexOf("if(req.method==='GET'&&req.url==='/v1/provider-connections')");
  const connectionsGuard=source.indexOf(guard,connectionsGet);
  const connectionsRead=source.indexOf("providerConnections.summaries",connectionsGet);
  assert.ok(connectionsGet>=0&&connectionsGuard>connectionsGet&&connectionsRead>connectionsGuard);
});

test('OAuth audit readiness is promoted only after the completion audit is persisted',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const callback=source.indexOf("if(url.pathname==='/v1/provider-oauth/callback')");
  const reconcile=source.indexOf("providerRuntimeControl.reconcileAuthorization({...authorization,scope:authorization.scope})",callback);
  const audit=source.indexOf("providerAuditor.record('provider.oauth.completed'",reconcile);
  const readiness=source.indexOf("providerReadinessEvidence?.markTrusted(",audit);
  const auditPatch=source.indexOf("{auditTrail:true}",readiness);
  assert.ok(callback>=0&&reconcile>callback&&audit>reconcile&&readiness>audit&&auditPatch>readiness);
});

test('Shopify webhook readiness matches canonical shop identity and remains ambiguity-safe',async()=>{
  const source=await readFile(new URL('../src/provider-webhooks.ts',import.meta.url),'utf8');
  assert.match(source,/lower\(external_account_id\)=lower\(\$1\)/);
  assert.match(source,/if\(result\.rows\.length!==1\)/);
});

test('Shopify provider API routes canonicalize account identity before control-plane access',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const helper=source.indexOf("const normalizeProviderAccountId=");
  assert.ok(helper>=0);
  assert.match(source,/provider==='shopify'\?value\.trim\(\)\.toLowerCase\(\):value/);

  const runtime=source.indexOf("const providerRuntimeMatch=");
  const runtimeNormalize=source.indexOf("normalizeProviderAccountId(provider,decodeURIComponent(accountRaw))",runtime);
  assert.ok(runtimeNormalize>runtime);

  const policy=source.indexOf("const policyMatch=");
  const policyNormalize=source.indexOf("normalizeProviderAccountId(provider,decodeURIComponent(policyMatch[2]))",policy);
  assert.ok(policyNormalize>policy);

  const readiness=source.indexOf("const readinessMatch=");
  const readinessNormalize=source.indexOf("normalizeProviderAccountId(provider,decodeURIComponent(readinessMatch[2]))",readiness);
  assert.ok(readinessNormalize>readiness);
});

test('provider capability audit records persisted canonical account identity',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("if(req.method==='POST'&&req.url==='/v1/provider-connections')");
  const mutation=source.indexOf("providerConnections.upsert({",route);
  const audit=source.indexOf("provider.connection.capabilities_updated",mutation);
  const canonical=source.indexOf("connection?.externalAccountId??normalizeProviderAccountId",audit);
  assert.ok(route>=0&&mutation>route&&audit>mutation&&canonical>audit);
});

test('provider agent policy currency validation rejects unsupported three-letter codes',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  assert.match(source,/new Set\(Intl\.supportedValuesOf\('currency'\)\)/);
  assert.match(source,/!supportedCurrencyCodes\.has\(currency\)/);
});

test('provider agent policies require tenant-authorized active agent identities',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  assert.match(source,/new PostgresProviderAgentRegistry\(dbPool\)/);
  assert.match(source,/providerAgentRegistry\.requireActive\(principal\.orgId,allowedAgents\)/);
  assert.match(source,/provider_agent_policy_agent_not_authorized/);
  assert.match(source,/provider\.agent_authorized/);
  assert.match(source,/provider\.agent_revoked/);
});


test('provider order reads are authenticated capability-gated and tenant scoped',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("const orderMatch=runtimeUrl.pathname.match(/^\\/v1\\/provider-orders");
  const guard=source.indexOf("if(!requireCapability(principal,'manage_provider_connections')) return send(res,403,{error:'forbidden'},principal.requestId);",route);
  const read=source.indexOf("providerRuntimeControl.readOrders(",route);
  const readBlock=source.slice(read,read+400);
  assert.ok(route>=0);
  assert.ok(guard>route&&guard<read);
  assert.match(readBlock,/companyId:principal\.orgId,provider,externalAccountId/);
});

test('provider order route canonicalizes Shopify identity before lookup',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("const orderMatch=runtimeUrl.pathname.match(/^\\/v1\\/provider-orders");
  const normalize=source.indexOf("normalizeProviderAccountId(provider,decodeURIComponent(orderMatch[2]))",route);
  const read=source.indexOf("providerRuntimeControl.readOrders(",route);
  assert.ok(route>=0&&normalize>route&&read>normalize);
});


test('provider checkout route binds execution to authenticated credential and payment authority',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("const providerCheckoutMatch=req.url?.match(/^\\/v1\\/provider-checkout");
  const capability=source.indexOf("if(!requireCapability(principal,'request_payment'))",route);
  const execute=source.indexOf("providerTransactionExecution.createCheckout({",route);
  const tenant=source.indexOf("companyId:principal.orgId",execute);
  const agent=source.indexOf("agentId:principal.credentialId",execute);
  assert.ok(route>=0);
  assert.ok(capability>route&&capability<execute);
  assert.ok(tenant>execute&&agent>execute);
  assert.equal(source.indexOf('agentId:payload.',route),-1);
});


test('transaction reconciliation requires admin authority before mutation',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("const reconciliationMatch=req.url?.match(/^\\/v1\\/provider-transactions");
  const guard=source.indexOf("if(!requireCapability(principal,'admin_override'))",route);
  const mutation=source.indexOf("providerTransactionIntents.resolveReconciliation({",route);
  const audit=source.indexOf("provider.transaction.reconciliation_resolved",mutation);
  assert.ok(route>=0);
  assert.ok(guard>route&&guard<mutation);
  assert.ok(audit>mutation);
});

test('transaction reconciliation exposes no blind provider order retry route',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("const reconciliationMatch=req.url?.match(/^\\/v1\\/provider-transactions");
  const end=source.indexOf("const providerCheckoutMatch",route);
  const block=source.slice(route,end);
  assert.doesNotMatch(block,/providerRuntimeControl\.createOrder/);
  assert.doesNotMatch(block,/providerTransactionExecution\.createCheckout/);
});


test('provider observability is admin-only and webhook failures are recorded',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("req.url==='/v1/provider-observability'");
  const guard=source.indexOf("requireCapability(principal,'admin_override')",route);
  const summary=source.indexOf("providerObservability.summary(principal.orgId)",route);
  assert.ok(route>=0);
  assert.ok(guard>route&&guard<summary);

  const stripeWebhook=source.indexOf("req.url==='/v1/webhooks/stripe'");
  const stripeRecord=source.indexOf("providerObservability?.record({provider:'stripe',eventType:'webhook.failed'",stripeWebhook);
  const shopifyWebhook=source.indexOf("req.url==='/v1/webhooks/shopify'");
  const shopifyRecord=source.indexOf("providerObservability?.record({provider:'shopify',eventType:'webhook.failed'",shopifyWebhook);
  assert.ok(stripeRecord>stripeWebhook);
  assert.ok(shopifyRecord>shopifyWebhook);
});


test('provider checkout executes only from signed draft and approval token',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("const providerCheckoutMatch=req.url?.match(/^\\/v1\\/provider-checkout");
  const end=source.indexOf("const providerAgentMatch",route);
  const block=source.slice(route,end);
  assert.match(block,/approvalToken/);
  assert.match(block,/verifyForExecution/);
  assert.match(block,/verifyApproval/);
  assert.doesNotMatch(block,/payload\.amount/);
  assert.doesNotMatch(block,/payload\.currency/);
  assert.doesNotMatch(block,/payload\.fulfillment/);
  assert.match(block,/amount:verified\.draft\.total/);
  assert.match(block,/fulfillment:state\.fulfillment/);
});

test('provider transaction draft endpoint signs the mutable intent before approval',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("req.url==='/v1/provider-transaction-drafts'");
  const checkout=source.indexOf("const providerCheckoutMatch",route);
  const block=source.slice(route,checkout);
  assert.ok(route>=0);
  assert.match(block,/providerTransactionDrafts\.create/);
  assert.match(block,/request_payment/);
  assert.match(block,/lineItems/);
});


test('refund compensation requires admin authority and refund-required state',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("const refundMatch=req.url?.match(/^\\/v1\\/provider-transactions");
  const guard=source.indexOf("if(!requireCapability(principal,'admin_override'))",route);
  const execute=source.indexOf("providerRefundCompensation.refund({",route);
  assert.ok(route>=0);
  assert.ok(guard>route&&guard<execute);

  const reconciliation=source.indexOf("const reconciliationMatch=",route);
  const noOrderMutation=source.indexOf("resolution:payload.resolution",reconciliation);
  assert.ok(reconciliation>route);
  assert.ok(noOrderMutation>reconciliation);
});

test('refund queue is admin-only',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("req.url?.startsWith('/v1/provider-transactions/refunds')");
  const guard=source.indexOf("if(!requireCapability(principal,'admin_override'))",route);
  const read=source.indexOf("providerTransactionIntents.listRefundRequired",route);
  assert.ok(route>=0&&guard>route&&read>guard);
});


test('Stripe refund finality is driven by verified webhook state, not synchronous submission',async()=>{
  const source=await readFile(new URL('../src/provider-refund-compensation.ts',import.meta.url),'utf8');
  assert.match(source,/markRefundSubmitted/);
  assert.doesNotMatch(source,/markRefunded\(/);

  const webhook=await readFile(new URL('../src/provider-webhooks.ts',import.meta.url),'utf8');
  assert.match(webhook,/refund\.updated/);
  assert.match(webhook,/refund\.failed/);
  assert.match(webhook,/applyStripeRefundEvent/);
  assert.match(webhook,/markRefunded/);
  assert.match(webhook,/markRefundFailed/);
});


test('API schedules refund recovery through advisory lock only when prerequisites exist',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  assert.match(source,/runRefundRecoveryWithAdvisoryLock/);
  assert.match(source,/if\(dbPool&&providerTransactionIntents&&process\.env\.STRIPE_SECRET_KEY\)/);
  assert.match(source,/PROVIDER_REFUND_RECOVERY_INTERVAL_MINUTES/);
  assert.match(source,/PROVIDER_REFUND_RECOVERY_STALE_MINUTES/);
  assert.match(source,/setInterval\(\(\)=>void runRefundRecoveryTick\(\)/);
  assert.doesNotMatch(source,/reconcileSubmittedRefunds\(\{/);
});


test('provider transaction amount is derived from Shopify quote, never client amount',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("req.url==='/v1/provider-transaction-drafts'");
  const checkout=source.indexOf("const providerCheckoutMatch",route);
  const block=source.slice(route,checkout);
  assert.match(block,/providerRuntimeControl\.quoteVariants/);
  assert.match(block,/providerRuntimeControl\.quoteLandedTotal/);
  assert.match(block,/landedQuoteTotalAmount/);
  assert.match(block,/pricing:quoteResult\.quote/);
  assert.match(block,/landedQuote:landedResult\.quote/);
  assert.doesNotMatch(block,/payload\.amount/);
  assert.doesNotMatch(block,/payload\.currency/);
});

test('checkout revalidates Shopify quote before approval verification and Stripe execution',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("const providerCheckoutMatch=req.url?.match(/^\\/v1\\/provider-checkout");
  const end=source.indexOf("const providerAgentMatch",route);
  const block=source.slice(route,end);
  const verifyDraft=block.indexOf('verifyForExecution');
  const liveQuote=block.indexOf('providerRuntimeControl.quoteVariants');
  const liveLandedQuote=block.indexOf('providerRuntimeControl.quoteLandedTotal');
  const reapproval=block.indexOf('provider_checkout_reapproval_required',liveLandedQuote);
  const approval=block.indexOf('verifyApproval');
  const checkout=block.indexOf('providerTransactionExecution.createCheckout');
  assert.ok(
    verifyDraft>=0&&
    liveQuote>verifyDraft&&
    liveLandedQuote>liveQuote&&
    reapproval>liveLandedQuote&&
    approval>reapproval&&
    checkout>approval
  );
});


test('direct payment confirmation audit event is accepted with safe metadata',async()=>{
  let seen:any;
  const auditor=new ProviderSecurityAuditor({
    async publish(streamId:string,type:string,payload:unknown){
      seen={streamId,type,payload};
      return {id:'evt-direct'};
    }
  } as any);
  await auditor.record('provider.transaction.direct_payment_confirmed',{
    companyId:'org-a',
    provider:'stripe',
    externalAccountId:'acct-1',
    agentId:'muse-agent',
    amount:58.32,
    currency:'USD',
    requestId:'req-direct'
  });
  assert.equal(seen.type,'provider.transaction.direct_payment_confirmed');
  assert.equal(seen.streamId,'provider:org-a');
});


test('Muse confirmation resolves saved payment from verified subject and never accepts payment identifiers from browser payload',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("if(req.method==='POST'&&req.url==='/v1/muse/confirm')");
  const end=source.indexOf("const principal=",route);
  const block=source.slice(route,end);
  assert.match(block,/resolveStripeSavedPayment\(identity\.subjectId\)/);
  assert.doesNotMatch(block,/payload.customerId/);
  assert.doesNotMatch(block,/payload.paymentMethodId/);
  assert.doesNotMatch(block,/savedStripeAuthorization:payload/);
});


test('consumer enrollment disables legacy route and uses subject-bound challenges',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("if(req.method==='POST'&&req.url==='/v1/consumer-commerce/enroll')");
  const end=source.indexOf("if(req.method==='POST'&&req.url==='/v1/muse/confirm')",route);
  const block=source.slice(route,end);
  assert.ok(route>=0);
  assert.match(block,/verifyHumanIdentity\(req\)/);
  assert.match(block,/use_subject_bound_enrollment/);
  assert.match(block,/enrollmentRequest/);
  assert.match(block,/completeConsumerEnrollment/);
  assert.doesNotMatch(block,/payload.setupIntentId/);
  assert.match(block,/verifyStripeSetupIntent/);
  assert.doesNotMatch(block,/payload.customerId/);
  assert.doesNotMatch(block,/payload.paymentMethodId/);
  assert.doesNotMatch(block,/payload.shopUserPublicId/);
});

test('OIDC verifier exposes Shop user identity only from configured trusted claim',async()=>{
  const source=await readFile(new URL('../../../services/mcp-gateway/src/business-identity.ts',import.meta.url),'utf8');
  assert.match(source,/shopUserIdClaim/);
  assert.match(source,/payload\[shopClaim\]/);
  const approval=await readFile(new URL('../src/approval.ts',import.meta.url),'utf8');
  assert.match(approval,/SHOP_OIDC_USER_ID_CLAIM/);
});


test('Muse purchase requires enrolled consumer commerce identity before transaction execution',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("if(req.method==='POST'&&req.url==='/v1/muse/confirm')");
  const end=source.indexOf("const principal=",route);
  const block=source.slice(route,end);
  const verify=block.indexOf('verifyHumanIdentity(req)');
  const resolve=block.indexOf('resolveStripeSavedPayment(identity.subjectId)');
  const required=block.indexOf("consumer_commerce_enrollment_required");
  const execute=block.indexOf('submitMuseConfirmation({');
  assert.ok(route>=0&&verify>=0&&resolve>verify&&required>resolve&&execute>required);
  assert.doesNotMatch(block,/createStripeCheckout/);
});


test('Muse approval uses subject-owned saved payment while generic approval has no enrollment dependency',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const generic=source.indexOf("if(req.method==='POST'&&req.url==='/v1/approvals/issue')");
  const muse=source.indexOf("if(req.method==='POST'&&req.url==='/v1/muse/approvals/issue')");
  const end=source.indexOf('if(sharedLimiter)',muse);
  assert.ok(generic>=0&&muse>generic&&end>muse);
  assert.doesNotMatch(source.slice(generic,muse),/consumerCommerceIdentities|resolveSavedPayment|paymentAuthorizationReference/);
  const block=source.slice(muse,end);
  assert.match(block,/resolveSavedPayment:async\(subjectId\)=>\([\s\S]*?consumerCommerceIdentities\.resolveStripeSavedPayment\(subjectId\)[\s\S]*?consumerCommerceIdentities\.resolveShopPaySavedPayment\(subjectId\)/);
  assert.doesNotMatch(block,/payload.paymentAuthorizationReference|payload.customerId|payload.paymentMethodId/);
});

test('Muse order status is scoped to verified consumer and reads tracking server-side',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=source.indexOf("const museOrderMatch=req.url?.match(/^\\/v1\\/muse\\/orders");
  const principal=source.indexOf("const principal=process.env.NODE_ENV==='production'",route);
  const block=source.slice(route,principal);
  const identity=block.indexOf('verifyHumanIdentity(req)');
  const owned=block.indexOf('getForConsumer(identity.subjectId,draftId)');
  const live=block.indexOf('providerRuntimeControl.readOrders(');
  assert.ok(route>=0&&identity>=0&&owned>identity&&live>owned);
  assert.doesNotMatch(block,/principal\.orgId/);
  assert.doesNotMatch(block,/payload\.subjectId/);
  assert.doesNotMatch(block,/payload\.companyId/);
});


test('buyer notification email comes only from verified OIDC identity and is delegated to providers',async()=>{
  const identity=await readFile(new URL('../../../services/mcp-gateway/src/business-identity.ts',import.meta.url),'utf8');
  assert.match(identity,/payload\.email_verified===true/);
  assert.match(identity,/payload\.email/);

  const api=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const route=api.indexOf("if(req.method==='POST'&&req.url==='/v1/muse/confirm')");
  const end=api.indexOf("const museOrderMatch=",route);
  const block=api.slice(route,end);
  assert.match(block,/identity\.email/);
  assert.match(block,/consumerEmail:identity\.email/);
  assert.doesNotMatch(block,/payload\.email/);

  const execution=await readFile(new URL('../src/provider-transaction-execution.ts',import.meta.url),'utf8');
  assert.match(execution,/receiptEmail:args\.consumerEmail/);
  assert.match(execution,/customerEmail:args\.consumerEmail/);
  assert.match(execution,/email:args\.consumerEmail/);

  const shopify=await readFile(new URL('../../../services/mcp-gateway/src/provider-draft-order.ts',import.meta.url),'utf8');
  assert.match(shopify,/args\.email\?\{email:args\.email\}/);
});

