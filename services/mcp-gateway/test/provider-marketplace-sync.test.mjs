import test from 'node:test';
import assert from 'node:assert/strict';
import {syncAmazonListings,syncEtsyListings} from '../dist/provider-sync.js';
import {deriveProviderConnectionHealth} from '../dist/provider-lifecycle.js';

test('normalizes Etsy shop listings',async()=>{
  const rows=await syncEtsyListings({
    accessToken:'test-value',
    apiKey:'example-key',
    shopId:'123',
    fetchImpl:async()=>new Response(JSON.stringify({
      results:[{
        listing_id:11,
        title:'Handmade mug',
        quantity:3,
        state:'active',
        price:{amount:2450,divisor:100,currency_code:'USD'}
      }]
    }),{status:200})
  });
  assert.equal(rows[0].title,'Handmade mug');
  assert.equal(rows[0].price,24.5);
  assert.equal(rows[0].quantity,3);
});

test('normalizes Amazon SP-API listings using an injected SigV4 transport',async()=>{
  let requested='';
  const rows=await syncAmazonListings({
    lwaAccessToken:'test-value',
    sellerId:'SELLER1',
    marketplaceId:'ATVPDKIKX0DER',
    signedFetch:async(url,init)=>{
      requested=url.toString();
      assert.equal(init.headers['x-amz-access-token'],'test-value');
      return new Response(JSON.stringify({
        items:[{
          sku:'A1',
          summaries:[{itemName:'Coffee maker',status:'BUYABLE'}],
          offers:[{price:{amount:129.99,currencyCode:'USD'}}],
          fulfillmentAvailability:[{quantity:8}]
        }]
      }),{status:200});
    }
  });
  assert.match(requested,/listings\/2021-08-01\/items\/SELLER1/);
  assert.equal(rows[0].title,'Coffee maker');
  assert.equal(rows[0].price,129.99);
  assert.equal(rows[0].quantity,8);
});

test('provider lifecycle reports token and partnership states',()=>{
  const now=new Date('2026-10-24T18:00:00Z');
  assert.equal(deriveProviderConnectionHealth({
    provider:'etsy',
    externalAccountId:'123',
    grantedCapabilities:['catalog.read'],
    tokenExpiresAt:'2026-10-24T18:05:00Z'
  },now),'TOKEN_EXPIRING');

  assert.equal(deriveProviderConnectionHealth({
    provider:'target',
    externalAccountId:'target',
    grantedCapabilities:['order.create']
  },now),'PARTNERSHIP_REQUIRED');
});
