import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProviderConsoleCards,
  summarizeProviderConsole,
  BusinessConsoleProviderClient
} from '../dist/provider-console.js';

test('provider console renders connected and partnership-gated stores distinctly',()=>{
  const cards=buildProviderConsoleCards({
    providers:[
      {
        provider:'walmart',
        displayName:'Walmart Marketplace',
        providerClass:'MARKETPLACE',
        sellerConnectionSupported:true,
        platformConnectionSupported:true,
        available:[],
        approvalRequired:['catalog.read'],
        partnershipRequired:[],
        notConfigured:[],
        canSelfServe:true
      },
      {
        provider:'target',
        displayName:'Target / Target Plus',
        providerClass:'MARKETPLACE',
        sellerConnectionSupported:false,
        platformConnectionSupported:true,
        available:[],
        approvalRequired:[],
        partnershipRequired:['catalog.read','order.create'],
        notConfigured:[],
        canSelfServe:false
      }
    ],
    connections:[
      {
        provider:'walmart',
        displayName:'Walmart Marketplace',
        externalAccountId:'seller-1',
        health:'HEALTHY',
        grantedCapabilities:['catalog.read'],
        lastSyncAt:'2026-10-24T17:30:00Z',
        partnershipRequired:[]
      }
    ]
  });

  const walmart=cards.find(card=>card.provider==='walmart');
  const target=cards.find(card=>card.provider==='target');
  assert.equal(walmart.connected,true);
  assert.equal(walmart.primaryAction,'VIEW_STATUS');
  assert.ok(walmart.secondaryActions.includes('SYNC_NOW'));
  assert.equal(target.connected,false);
  assert.equal(target.primaryAction,'CONTACT_PARTNERSHIPS');
});

test('provider console promotes re-authentication when tokens need attention',()=>{
  const cards=buildProviderConsoleCards({
    providers:[{
      provider:'ebay',
      displayName:'eBay',
      providerClass:'MARKETPLACE',
      sellerConnectionSupported:true,
      platformConnectionSupported:true,
      available:[],
      approvalRequired:['catalog.read'],
      partnershipRequired:[],
      notConfigured:[],
      canSelfServe:true
    }],
    connections:[{
      provider:'ebay',
      displayName:'eBay',
      externalAccountId:'seller-1',
      health:'TOKEN_EXPIRING',
      grantedCapabilities:['catalog.read'],
      partnershipRequired:[]
    }]
  });
  assert.equal(cards[0].primaryAction,'REAUTHENTICATE');
  assert.equal(summarizeProviderConsole(cards).attention,1);
});

test('provider console client calls control-plane endpoints',async()=>{
  const calls=[];
  const transport={
    async get(path){
      calls.push(['GET',path]);
      if(path==='/v1/providers') return {providers:[]};
      return {connections:[]};
    },
    async post(path,body){
      calls.push(['POST',path,body]);
      return {ok:true};
    }
  };
  const client=new BusinessConsoleProviderClient(transport);
  const loaded=await client.load();
  assert.equal(loaded.summary.total,0);

  await client.sync('etsy','shop/1','listings');
  assert.deepEqual(calls.at(-1),['POST','/v1/provider-runtime/etsy/shop%2F1/sync',{kind:'listings'}]);

  await client.rekey('etsy','shop/1');
  assert.deepEqual(calls.at(-1),['POST','/v1/provider-runtime/etsy/shop%2F1/rekey',undefined]);

  await client.rekeyBatch(25);
  assert.deepEqual(calls.at(-1),['POST','/v1/provider-credentials/rekey-batch',{limit:25}]);

  await client.revoke('etsy','shop/1');
  assert.deepEqual(calls.at(-1),['POST','/v1/provider-runtime/etsy/shop%2F1/revoke',undefined]);
});
