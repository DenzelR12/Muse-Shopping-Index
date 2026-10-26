import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderRuntimeControlPlane,shopifyCapabilitiesFromScope} from '../dist/provider-runtime-control.js';

function fakeConnections(){
  const state=new Map();
  const key=(c,p,a)=>[c,p,a].join('|');
  return {
    async get(c,p,a){
      return state.get(key(c,p,a))??null;
    },
    async reconcileAuthorization(input){
      const k=key(input.companyId,input.provider,input.externalAccountId);
      const existing=state.get(k);
      const next={
        companyId:input.companyId,
        provider:input.provider,
        externalAccountId:input.externalAccountId,
        grantedCapabilities:input.grantedCapabilities??existing?.grantedCapabilities??[],
        tokenExpiresAt:input.tokenExpiresAt,
        revokedAt:undefined
      };
      state.set(k,next);
      return next;
    },
    async updateTokenExpiry(c,p,a,expiresAt){
      const k=key(c,p,a);
      const row=state.get(k);
      if(!row) return null;
      row.tokenExpiresAt=expiresAt;
      row.revokedAt=undefined;
      return row;
    },
    async markSyncSuccess(c,p,a){
      const row=state.get(key(c,p,a));
      if(!row) return null;
      row.lastSyncAt='2026-10-24T18:30:00Z';
      row.lastSyncError=undefined;
      return row;
    },
    async markSyncError(c,p,a,error){
      const row=state.get(key(c,p,a));
      if(!row) return null;
      row.lastSyncError=error;
      return row;
    },
    async revoke(c,p,a){
      const row=state.get(key(c,p,a));
      if(!row) return null;
      row.revokedAt='2026-10-24T18:31:00Z';
      return row;
    },
    state
  };
}

test('authorization reconciliation preserves only existing verified capabilities',async()=>{
  const connections=fakeConnections();
  const runtime={};
  const control=new ProviderRuntimeControlPlane(runtime,connections);
  const result=await control.reconcileAuthorization({
    companyId:'org-a',
    provider:'etsy',
    externalAccountId:'shop-1',
    expiresAt:'2026-10-24T19:00:00Z'
  });
  assert.deepEqual(result.grantedCapabilities,[]);

  result.grantedCapabilities=['catalog.read'];
  connections.state.set('org-a|etsy|shop-1',result);

  const refreshed=await control.reconcileAuthorization({
    companyId:'org-a',
    provider:'etsy',
    externalAccountId:'shop-1',
    expiresAt:'2026-10-24T20:00:00Z'
  });
  assert.deepEqual(refreshed.grantedCapabilities,['catalog.read']);
});

test('runtime refresh updates connection expiry automatically',async()=>{
  const connections=fakeConnections();
  await connections.reconcileAuthorization({
    companyId:'org-a',
    provider:'ebay',
    externalAccountId:'seller-1',
    tokenExpiresAt:'2026-10-24T19:00:00Z'
  });
  const runtime={
    async refresh(){
      return {
        companyId:'org-a',
        provider:'ebay',
        externalAccountId:'seller-1',
        expiresAt:'2026-10-24T21:00:00Z'
      };
    }
  };
  const control=new ProviderRuntimeControlPlane(runtime,connections);
  const result=await control.refresh({companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'});
  assert.equal(result.connection.tokenExpiresAt,'2026-10-24T21:00:00Z');
});

test('sync success and error reconcile lifecycle automatically',async()=>{
  const connections=fakeConnections();
  await connections.reconcileAuthorization({
    companyId:'org-a',
    provider:'ebay',
    externalAccountId:'seller-1',
    tokenExpiresAt:'2026-10-24T19:00:00Z'
  });

  const okControl=new ProviderRuntimeControlPlane({
    async sync(){return [{provider:'ebay',externalId:'1',raw:{}}];}
  },connections);
  const ok=await okControl.sync(
    {companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
    {kind:'inventory'}
  );
  assert.equal(ok.items.length,1);
  assert.equal(ok.connection.lastSyncAt,'2026-10-24T18:30:00Z');

  const errorControl=new ProviderRuntimeControlPlane({
    async sync(){throw new Error('provider_sync_failed');}
  },connections);
  await assert.rejects(
    errorControl.sync(
      {companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
      {kind:'inventory'}
    ),
    /provider_sync_failed/
  );
  assert.equal(
    connections.state.get('org-a|ebay|seller-1').lastSyncError,
    'provider_sync_failed'
  );
});

test('revoke removes runtime credential and marks connection revoked',async()=>{
  const connections=fakeConnections();
  await connections.reconcileAuthorization({
    companyId:'org-a',
    provider:'etsy',
    externalAccountId:'shop-1',
    tokenExpiresAt:'2026-10-24T19:00:00Z'
  });
  const runtime={async revoke(){return {credentialRevoked:true,upstream:'unsupported'};}};
  const control=new ProviderRuntimeControlPlane(runtime,connections);
  const result=await control.revoke({companyId:'org-a',provider:'etsy',externalAccountId:'shop-1'});
  assert.equal(result.credentialRevoked,true);
  assert.equal(result.upstream,'unsupported');
  assert.ok(result.connection.revokedAt);
});

test('rekey migrates one exact provider account and emits audit event',async()=>{
  const connections=fakeConnections();
  const events=[];
  const runtime={
    async rekey(key){
      assert.deepEqual(key,{companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'});
      return {...key,version:3};
    }
  };
  const auditor={async record(type,metadata){events.push({type,metadata});}};
  const control=new ProviderRuntimeControlPlane(runtime,connections,auditor);
  const result=await control.rekey({companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'});
  assert.equal(result.version,3);
  assert.deepEqual(events,[{
    type:'provider.credential.rekeyed',
    metadata:{companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'}
  }]);
});

test('refresh fails before runtime credential rotation when connection record is missing',async()=>{
  const connections=fakeConnections();
  let refreshCalls=0;
  const runtime={
    async refresh(){
      refreshCalls+=1;
      return {expiresAt:'2099-01-01T00:00:00Z'};
    }
  };
  const control=new ProviderRuntimeControlPlane(runtime,connections);
  await assert.rejects(
    control.refresh({companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'}),
    /provider_connection_not_found/
  );
  assert.equal(refreshCalls,0);
});

test('trusted OAuth and catalog sync promote only system-derived readiness evidence',async()=>{
  const connections=fakeConnections();
  const evidenceRows=[];
  const evidence={
    async resetAuthorizationEpoch(key,trusted){
      evidenceRows.push({key,patch:{identityVerified:trusted.identityVerified,auditTrail:trusted.auditTrail}});
      return {...key,...trusted};
    },
    async markTrusted(key,patch){
      evidenceRows.push({key,patch});
      return {...key,...patch};
    }
  };
  const events=[];
  const auditor={async record(type,metadata){events.push({type,metadata});}};
  const runtime={
    async sync(){return [{provider:'ebay',externalId:'1',raw:{}}];}
  };
  const control=new ProviderRuntimeControlPlane(runtime,connections,auditor,evidence);
  await control.reconcileAuthorization({
    companyId:'org-a',provider:'ebay',externalAccountId:'seller-1',expiresAt:'2099-01-01T00:00:00Z'
  });
  await control.sync(
    {companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
    {kind:'catalog'}
  );
  assert.deepEqual(evidenceRows,[
    {
      key:{companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
      patch:{identityVerified:true,auditTrail:false}
    },
    {
      key:{companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
      patch:{catalogValidated:true,auditTrail:true}
    }
  ]);
});

test('batch rekey is tenant scoped and emits aggregate audit status',async()=>{
  const connections=fakeConnections();
  const events=[];
  const auditor={async record(type,metadata){events.push({type,metadata});}};
  const runtime={
    async rekeyBatch(companyId,limit){
      assert.equal(companyId,'org-a');
      assert.equal(limit,25);
      return {companyId,currentKeyId:'new',migrated:2,remaining:1};
    }
  };
  const control=new ProviderRuntimeControlPlane(runtime,connections,auditor);
  const result=await control.rekeyBatch('org-a',25);
  assert.deepEqual(result,{companyId:'org-a',currentKeyId:'new',migrated:2,remaining:1});
  assert.deepEqual(events,[{
    type:'provider.credential.rekey_batch',
    metadata:{
      companyId:'org-a',
      provider:'all',
      currentKeyId:'new',
      migratedCount:2,
      remainingCount:1
    }
  }]);
});

test('successful token refresh promotes provider revalidation evidence',async()=>{
  const connections=fakeConnections();
  await connections.reconcileAuthorization({
    companyId:'org-a',
    provider:'ebay',
    externalAccountId:'seller-1',
    tokenExpiresAt:'2026-10-24T19:00:00Z'
  });
  const evidenceRows=[];
  const evidence={
    async markTrusted(key,patch){
      evidenceRows.push({key,patch});
      return {...key,...patch};
    }
  };
  const auditor={async record(){}};
  const runtime={
    async refresh(){
      return {
        companyId:'org-a',
        provider:'ebay',
        externalAccountId:'seller-1',
        expiresAt:'2099-01-01T00:00:00Z'
      };
    }
  };
  const control=new ProviderRuntimeControlPlane(runtime,connections,auditor,evidence);
  await control.refresh({companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'});
  assert.deepEqual(evidenceRows,[{
    key:{companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
    patch:{providerRevalidation:true,auditTrail:true}
  }]);
});

test('successful sync after a persisted sync failure verifies recovery readiness',async()=>{
  const connections=fakeConnections();
  await connections.reconcileAuthorization({
    companyId:'org-a',
    provider:'ebay',
    externalAccountId:'seller-1',
    tokenExpiresAt:'2099-01-01T00:00:00Z'
  });
  await connections.markSyncError('org-a','ebay','seller-1','provider_timeout');
  const evidenceRows=[];
  const events=[];
  const evidence={
    async markTrusted(key,patch){
      evidenceRows.push({key,patch});
      return {...key,...patch};
    }
  };
  const auditor={async record(type,metadata){events.push({type,metadata});}};
  const runtime={async sync(){return [{provider:'ebay',externalId:'1',raw:{}}];}};
  const control=new ProviderRuntimeControlPlane(runtime,connections,auditor,evidence);
  await control.sync(
    {companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
    {kind:'inventory'}
  );
  assert.deepEqual(evidenceRows,[{
    key:{companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
    patch:{recoveryActions:true,auditTrail:true}
  }]);
  assert.deepEqual(events.map(event=>event.type),[
    'provider.sync.succeeded',
    'provider.recovery.verified'
  ]);
});

test('ordinary successful sync does not claim recovery readiness',async()=>{
  const connections=fakeConnections();
  await connections.reconcileAuthorization({
    companyId:'org-a',
    provider:'ebay',
    externalAccountId:'seller-1',
    tokenExpiresAt:'2099-01-01T00:00:00Z'
  });
  const evidenceRows=[];
  const evidence={async markTrusted(key,patch){evidenceRows.push({key,patch});}};
  const runtime={async sync(){return [{provider:'ebay',externalId:'1',raw:{}}];}};
  const control=new ProviderRuntimeControlPlane(runtime,connections,undefined,evidence);
  await control.sync(
    {companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
    {kind:'inventory'}
  );
  assert.deepEqual(evidenceRows,[]);
});

test('fresh authorization resets stale readiness evidence before trust is rebuilt',async()=>{
  const connections=fakeConnections();
  const calls=[];
  const evidence={
    async resetAuthorizationEpoch(key,trusted){
      calls.push({kind:'reset',key,trusted});
    }
  };
  const auditor={async record(){}};
  const control=new ProviderRuntimeControlPlane({},connections,auditor,evidence);
  await control.reconcileAuthorization({
    companyId:'org-a',
    provider:'ebay',
    externalAccountId:'seller-1',
    expiresAt:'2099-01-01T00:00:00Z'
  });
  assert.deepEqual(calls,[{
    kind:'reset',
    key:{companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
    trusted:{identityVerified:true,auditTrail:false}
  }]);
});

test('revocation clears connection-bound readiness evidence',async()=>{
  const connections=fakeConnections();
  await connections.reconcileAuthorization({
    companyId:'org-a',
    provider:'etsy',
    externalAccountId:'shop-1',
    tokenExpiresAt:'2099-01-01T00:00:00Z'
  });
  const calls=[];
  const evidence={
    async clearForRevocation(key){calls.push(key);}
  };
  const runtime={async revoke(){return {credentialRevoked:true,upstream:'unsupported'};}};
  const control=new ProviderRuntimeControlPlane(runtime,connections,undefined,evidence);
  await control.revoke({companyId:'org-a',provider:'etsy',externalAccountId:'shop-1'});
  assert.deepEqual(calls,[{companyId:'org-a',provider:'etsy',externalAccountId:'shop-1'}]);
});


test('order reads require both order.read and fulfillment.read capabilities',async()=>{
  const connections=fakeConnections();
  await connections.reconcileAuthorization({
    companyId:'org-a',
    provider:'shopify',
    externalAccountId:'example-shop.myshopify.com',
    tokenExpiresAt:'2099-01-01T00:00:00Z'
  });
  const row=connections.state.get('org-a|shopify|example-shop.myshopify.com');
  row.grantedCapabilities=['order.read'];
  const runtime={async readOrders(){return [];}};
  const control=new ProviderRuntimeControlPlane(runtime,connections);
  await assert.rejects(
    control.readOrders({companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'}),
    /provider_capability_not_granted/
  );

  row.grantedCapabilities=['order.read','fulfillment.read'];
  const result=await control.readOrders({
    companyId:'org-a',
    provider:'shopify',
    externalAccountId:'example-shop.myshopify.com'
  });
  assert.deepEqual(result.orders,[]);
});

test('order reads emit safe audit metadata',async()=>{
  const connections=fakeConnections();
  await connections.reconcileAuthorization({
    companyId:'org-a',
    provider:'shopify',
    externalAccountId:'example-shop.myshopify.com',
    tokenExpiresAt:'2099-01-01T00:00:00Z'
  });
  const row=connections.state.get('org-a|shopify|example-shop.myshopify.com');
  row.grantedCapabilities=['order.read','fulfillment.read'];
  const events=[];
  const runtime={async readOrders(){return [{externalId:'1'}];}};
  const auditor={async record(type,metadata){events.push({type,metadata});}};
  const control=new ProviderRuntimeControlPlane(runtime,connections,auditor);
  await control.readOrders({
    companyId:'org-a',
    provider:'shopify',
    externalAccountId:'example-shop.myshopify.com'
  });
  assert.deepEqual(events,[{
    type:'provider.orders.read',
    metadata:{
      companyId:'org-a',
      provider:'shopify',
      externalAccountId:'example-shop.myshopify.com',
      itemCount:1
    }
  }]);
});


test('pricing quote requires both pricing and inventory capabilities',async()=>{
  const connections=fakeConnections();
  await connections.reconcileAuthorization({
    companyId:'org-a',
    provider:'shopify',
    externalAccountId:'example-shop.myshopify.com',
    tokenExpiresAt:'2099-01-01T00:00:00Z'
  });
  const row=connections.state.get('org-a|shopify|example-shop.myshopify.com');
  row.grantedCapabilities=['pricing.read'];
  connections.state.set('org-a|shopify|example-shop.myshopify.com',row);
  let calls=0;
  const control=new ProviderRuntimeControlPlane({async quoteVariants(){calls++;return {currency:'USD',lines:[]};}},connections);
  await assert.rejects(
    control.quoteVariants(
      {companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'},
      {lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}]}
    ),
    /provider_capability_not_granted/
  );
  assert.equal(calls,0);

  row.grantedCapabilities=['pricing.read','inventory.read'];
  const result=await control.quoteVariants(
    {companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'},
    {lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}]}
  );
  assert.equal(result.quote.currency,'USD');
  assert.equal(calls,1);
});


test('Shopify OAuth scopes derive only capabilities actually granted by the token',()=>{
  const basic=shopifyCapabilitiesFromScope('read_products,read_inventory,read_orders,write_orders');
  assert.deepEqual(new Set(basic),new Set([
    'catalog.read','pricing.read','inventory.read','order.read','fulfillment.read',
    'returns.read','order.create','order.cancel'
  ]));
  assert.equal(basic.includes('quote.create'),false);

  const quoted=shopifyCapabilitiesFromScope('read_products read_inventory write_draft_orders');
  assert.equal(quoted.includes('quote.create'),true);
  assert.equal(quoted.includes('order.create'),false);
});

test('Shopify reauthorization replaces stale capabilities with current OAuth scope truth',async()=>{
  const connections=fakeConnections();
  const control=new ProviderRuntimeControlPlane({},connections);
  const first=await control.reconcileAuthorization({
    companyId:'org-a',
    provider:'shopify',
    externalAccountId:'example-shop.myshopify.com',
    expiresAt:'2099-01-01T00:00:00Z',
    scope:'read_products read_inventory write_draft_orders'
  });
  assert.equal(first.grantedCapabilities.includes('quote.create'),true);

  const second=await control.reconcileAuthorization({
    companyId:'org-a',
    provider:'shopify',
    externalAccountId:'example-shop.myshopify.com',
    expiresAt:'2099-01-02T00:00:00Z',
    scope:'read_products'
  });
  assert.equal(second.grantedCapabilities.includes('quote.create'),false);
  assert.deepEqual(new Set(second.grantedCapabilities),new Set(['catalog.read','pricing.read']));
});


test('landed quote requires verified pricing inventory and quote capabilities',async()=>{
  const connections=fakeConnections();
  await connections.reconcileAuthorization({
    companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com',
    tokenExpiresAt:'2099-01-01T00:00:00Z'
  });
  const row=connections.state.get('org-a|shopify|example-shop.myshopify.com');
  row.grantedCapabilities=['pricing.read','inventory.read'];
  let calls=0;
  const control=new ProviderRuntimeControlPlane({async quoteLandedTotal(){calls++;return {currency:'USD',total:'25.00'};}},connections);
  await assert.rejects(
    control.quoteLandedTotal(
      {companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'},
      {lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}],shippingAddress:{address1:'123 Main St',city:'Atlanta',countryCode:'US',zip:'30303'}}
    ),
    /provider_capability_not_granted/
  );
  assert.equal(calls,0);
  row.grantedCapabilities.push('quote.create');
  const result=await control.quoteLandedTotal(
    {companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'},
    {lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}],shippingAddress:{address1:'123 Main St',city:'Atlanta',countryCode:'US',zip:'30303'}}
  );
  assert.equal(result.quote.total,'25.00');
  assert.equal(calls,1);
});


test('Shopify draft lifecycle requires verified quote.create capability',async()=>{
  const connections=fakeConnections();
  await connections.reconcileAuthorization({
    companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com',
    tokenExpiresAt:'2099-01-01T00:00:00Z'
  });
  const row=connections.state.get('org-a|shopify|example-shop.myshopify.com');
  row.grantedCapabilities=['pricing.read','inventory.read'];
  let createCalls=0;
  let completeCalls=0;
  const control=new ProviderRuntimeControlPlane({
    async createDraftOrder(){createCalls++;return {draftOrderId:'gid://shopify/DraftOrder/1'};},
    async completeDraftOrder(){completeCalls++;return {providerOrderId:'gid://shopify/Order/1'};}
  },connections);

  const args={
    giftSignalDraftId:'draft-1',
    lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}],
    shippingAddress:{address1:'123 Main St',city:'Atlanta',countryCode:'US',zip:'30303'},
    landedQuote:{currency:'USD',subtotal:'20.00',tax:'2.00',shipping:{handle:'ground',title:'Ground',amount:'5.00'},total:'27.00'}
  };
  await assert.rejects(
    control.createDraftOrder({companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'},args),
    /provider_capability_not_granted/
  );
  assert.equal(createCalls,0);

  row.grantedCapabilities.push('quote.create');
  const created=await control.createDraftOrder(
    {companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'},args
  );
  assert.equal(created.result.draftOrderId,'gid://shopify/DraftOrder/1');
  const completed=await control.completeDraftOrder(
    {companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'},
    {draftOrderId:'gid://shopify/DraftOrder/1'}
  );
  assert.equal(completed.result.providerOrderId,'gid://shopify/Order/1');
  assert.equal(createCalls,1);
  assert.equal(completeCalls,1);
});
