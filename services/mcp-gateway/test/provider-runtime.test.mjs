import test from 'node:test';
import assert from 'node:assert/strict';
import {VaultBackedProviderRuntime} from '../dist/provider-runtime.js';

class FakeVault {
  constructor(){this.map=new Map();}
  key(k){return [k.companyId,k.provider,k.externalAccountId].join('|');}
  async save(key,token){this.map.set(this.key(key),{token});}
  async load(key){return this.map.get(this.key(key))??null;}
  async revoke(key){return this.map.delete(this.key(key));}
}

test('runtime refuses cross-tenant credential access',async()=>{
  const vault=new FakeVault();
  await vault.save(
    {companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
    {provider:'ebay',externalAccountId:'seller-1',accessToken:'a',refreshToken:'r',tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z'}
  );
  const runtime=new VaultBackedProviderRuntime(vault,{});
  await assert.rejects(
    runtime.sync(
      {companyId:'org-b',provider:'ebay',externalAccountId:'seller-1'},
      {kind:'inventory',fetchImpl:async()=>new Response('{}',{status:200})}
    ),
    /provider_credential_not_found/
  );
});

test('runtime sync uses only scoped vault credentials',async()=>{
  const vault=new FakeVault();
  await vault.save(
    {companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
    {provider:'ebay',externalAccountId:'seller-1',accessToken:'scoped-access',refreshToken:'r',tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z'}
  );
  let auth='';
  const runtime=new VaultBackedProviderRuntime(vault,{});
  const rows=await runtime.sync(
    {companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
    {
      kind:'inventory',
      fetchImpl:async(_url,init)=>{
        auth=String(init.headers.authorization);
        return new Response(JSON.stringify({inventoryItems:[]}),{status:200});
      }
    }
  );
  assert.equal(rows.length,0);
  assert.equal(auth,'Bearer scoped-access');
});

test('runtime blocks expired scoped credentials before provider request',async()=>{
  const vault=new FakeVault();
  await vault.save(
    {companyId:'org-a',provider:'walmart',externalAccountId:'seller-1'},
    {provider:'walmart',externalAccountId:'seller-1',accessToken:'expired',refreshToken:'r',tokenType:'Bearer',expiresAt:'2000-01-01T00:00:00Z'}
  );
  const runtime=new VaultBackedProviderRuntime(vault,{});
  await assert.rejects(
    runtime.sync(
      {companyId:'org-a',provider:'walmart',externalAccountId:'seller-1'},
      {kind:'catalog',fetchImpl:async()=>{throw new Error('should_not_call');}}
    ),
    /provider_access_token_expired/
  );
});

test('runtime revoke cannot cross tenant boundary',async()=>{
  const vault=new FakeVault();
  await vault.save(
    {companyId:'org-a',provider:'etsy',externalAccountId:'shop-1'},
    {provider:'etsy',externalAccountId:'shop-1',accessToken:'a',refreshToken:'r',tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z'}
  );
  const runtime=new VaultBackedProviderRuntime(vault,{});
  assert.deepEqual(
    await runtime.revoke({companyId:'org-b',provider:'etsy',externalAccountId:'shop-1'}),
    {credentialRevoked:false,upstream:'not_found'}
  );
  assert.ok(await vault.load({companyId:'org-a',provider:'etsy',externalAccountId:'shop-1'}));
});

test('Etsy runtime resolves shop id from stored OAuth user identity before listing sync',async()=>{
  const vault=new FakeVault();
  await vault.save(
    {companyId:'org-a',provider:'etsy',externalAccountId:'12345678'},
    {provider:'etsy',externalAccountId:'12345678',accessToken:'etsy-access',refreshToken:'r',tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z'}
  );
  const seen=[];
  const runtime=new VaultBackedProviderRuntime(vault,{});
  const rows=await runtime.sync(
    {companyId:'org-a',provider:'etsy',externalAccountId:'12345678'},
    {
      kind:'listings',
      apiKey:'etsy-key',
      fetchImpl:async(url,init)=>{
        seen.push(String(url));
        if(String(url).includes('/users/12345678/shops')){
          return new Response(JSON.stringify({shop_id:98765,user_id:12345678}),{status:200});
        }
        assert.match(String(url),/\/shops\/98765\/listings/);
        assert.equal(init.headers.authorization,'Bearer etsy-access');
        return new Response(JSON.stringify({results:[]}),{status:200});
      }
    }
  );
  assert.equal(rows.length,0);
  assert.equal(seen.length,2);
});

test('eBay revoke invalidates upstream refresh token before local deletion',async()=>{
  const vault=new FakeVault();
  const key={companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'};
  await vault.save(key,{
    provider:'ebay',externalAccountId:'seller-1',accessToken:'access-a',refreshToken:'refresh-r',
    tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z'
  });
  let seenUrl='';
  let seenBody='';
  const runtime=new VaultBackedProviderRuntime(vault,{EBAY_CLIENT_ID:'client',EBAY_CLIENT_SECRET:'secret'});
  const result=await runtime.revoke(key,{
    fetchImpl:async(url,init)=>{
      seenUrl=String(url);
      seenBody=String(init.body);
      assert.match(String(init.headers.authorization),/^Basic /);
      return new Response('',{status:200});
    }
  });
  assert.equal(seenUrl,'https://api.ebay.com/identity/v1/oauth2/token/revoke');
  assert.match(seenBody,/token=refresh-r/);
  assert.match(seenBody,/token_type_hint=refresh_token/);
  assert.deepEqual(result,{credentialRevoked:true,upstream:'revoked'});
  assert.equal(await vault.load(key),null);
});

test('failed eBay upstream revoke preserves local credential for retry',async()=>{
  const vault=new FakeVault();
  const key={companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'};
  await vault.save(key,{
    provider:'ebay',externalAccountId:'seller-1',accessToken:'access-a',refreshToken:'refresh-r',
    tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z'
  });
  const runtime=new VaultBackedProviderRuntime(vault,{EBAY_CLIENT_ID:'client',EBAY_CLIENT_SECRET:'secret'});
  await assert.rejects(
    runtime.revoke(key,{fetchImpl:async()=>new Response('',{status:500})}),
    /provider_upstream_revoke_failed/
  );
  assert.ok(await vault.load(key));
});

test('providers without documented app-side revocation are explicitly local-only',async()=>{
  const vault=new FakeVault();
  const key={companyId:'org-a',provider:'etsy',externalAccountId:'12345'};
  await vault.save(key,{
    provider:'etsy',externalAccountId:'12345',accessToken:'a',refreshToken:'r',
    tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z'
  });
  const runtime=new VaultBackedProviderRuntime(vault,{});
  assert.deepEqual(await runtime.revoke(key),{credentialRevoked:true,upstream:'unsupported'});
  assert.equal(await vault.load(key),null);
});


test('Shopify order read uses scoped vault token and normalizes fulfillment status',async()=>{
  const vault=new FakeVault();
  const key={companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'};
  await vault.save(key,{
    provider:'shopify',
    externalAccountId:'example-shop.myshopify.com',
    accessToken:'shopify-scoped',
    refreshToken:'refresh',
    tokenType:'Bearer',
    expiresAt:'2099-01-01T00:00:00Z'
  });
  let seenUrl='';
  let seenToken='';
  const runtime=new VaultBackedProviderRuntime(vault,{SHOPIFY_ADMIN_API_VERSION:'2026-10'});
  const orders=await runtime.readOrders(key,{
    limit:1,
    fetchImpl:async(url,init)=>{
      seenUrl=String(url);
      seenToken=String(init.headers['x-shopify-access-token']);
      return new Response(JSON.stringify({
        data:{
          orders:{
            nodes:[{
              id:'gid://shopify/Order/1',
              name:'#1001',
              createdAt:'2026-10-24T20:00:00Z',
              displayFinancialStatus:'PAID',
              displayFulfillmentStatus:'FULFILLED',
              totalPriceSet:{shopMoney:{amount:'125.50',currencyCode:'USD'}},
              fulfillments:[{
                id:'gid://shopify/Fulfillment/1',
                status:'SUCCESS',
                displayStatus:'DELIVERED',
                createdAt:'2026-10-24T20:05:00Z',
                updatedAt:'2026-10-24T21:00:00Z',
                deliveredAt:'2026-10-24T21:00:00Z',
                trackingInfo:[{company:'UPS',number:'1ZTEST',url:'https://example.test/track'}]
              }]
            }]
          }
        }
      }),{status:200});
    }
  });
  assert.equal(seenUrl,'https://example-shop.myshopify.com/admin/api/2026-10/graphql.json');
  assert.equal(seenToken,'shopify-scoped');
  assert.equal(orders.length,1);
  assert.equal(orders[0].externalId,'gid://shopify/Order/1');
  assert.equal(orders[0].fulfillmentStatus,'FULFILLED');
  assert.equal(orders[0].fulfillments[0].displayStatus,'DELIVERED');
  assert.equal(orders[0].totalAmount,125.5);
});

test('Shopify order read remains tenant scoped',async()=>{
  const vault=new FakeVault();
  await vault.save(
    {companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'},
    {provider:'shopify',externalAccountId:'example-shop.myshopify.com',accessToken:'a',refreshToken:'r',tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z'}
  );
  const runtime=new VaultBackedProviderRuntime(vault,{});
  await assert.rejects(
    runtime.readOrders(
      {companyId:'org-b',provider:'shopify',externalAccountId:'example-shop.myshopify.com'},
      {fetchImpl:async()=>{throw new Error('should_not_call');}}
    ),
    /provider_credential_not_found/
  );
});


test('Walmart order read uses scoped token and normalizes line fulfillment status',async()=>{
  const vault=new FakeVault();
  const key={companyId:'org-a',provider:'walmart',externalAccountId:'seller-1'};
  await vault.save(key,{
    provider:'walmart',
    externalAccountId:'seller-1',
    accessToken:'walmart-scoped',
    refreshToken:'refresh',
    tokenType:'Bearer',
    expiresAt:'2099-01-01T00:00:00Z'
  });
  let seenUrl='';
  let seenToken='';
  let correlation='';
  const runtime=new VaultBackedProviderRuntime(vault,{});
  const orders=await runtime.readOrders(key,{
    limit:2,
    fetchImpl:async(url,init)=>{
      seenUrl=String(url);
      seenToken=String(init.headers['wm-sec.access_token']);
      correlation=String(init.headers['wm-qos.correlation_id']);
      return new Response(JSON.stringify({
        list:{
          elements:{
            order:[{
              purchaseOrderId:'PO-1',
              customerOrderId:'CO-1',
              orderDate:1792890000000,
              orderLines:{
                orderLine:[{
                  lineNumber:'1',
                  statusDate:1792893600000,
                  orderLineStatuses:{orderLineStatus:[{status:'Delivered'}]},
                  fulfillment:{fulfillmentOption:'S2H',shipMethod:'VALUE'}
                }]
              }
            }]
          }
        }
      }),{status:200});
    }
  });
  assert.match(seenUrl,/https:\/\/marketplace\.walmartapis\.com\/v3\/orders\?limit=2/);
  assert.equal(seenToken,'walmart-scoped');
  assert.ok(correlation.length>10);
  assert.equal(orders.length,1);
  assert.equal(orders[0].provider,'walmart');
  assert.equal(orders[0].externalId,'PO-1');
  assert.equal(orders[0].fulfillmentStatus,'Delivered');
  assert.equal(orders[0].fulfillments[0].status,'Delivered');
});


test('Shopify order create uses scoped vault token and paid order mutation',async()=>{
  const vault=new FakeVault();
  const key={companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'};
  await vault.save(key,{
    provider:'shopify',externalAccountId:'example-shop.myshopify.com',
    accessToken:'shopify-scoped',refreshToken:'r',tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z'
  });
  let seenToken='';
  let body;
  const runtime=new VaultBackedProviderRuntime(vault,{SHOPIFY_ADMIN_API_VERSION:'2026-10'});
  const result=await runtime.createOrder(key,{
    draftId:'draft-1',
    lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:2}],
    fetchImpl:async(_url,init)=>{
      seenToken=String(init.headers['x-shopify-access-token']);
      body=JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        data:{orderCreate:{userErrors:[],order:{id:'gid://shopify/Order/999'}}}
      }),{status:200});
    }
  });
  assert.equal(seenToken,'shopify-scoped');
  assert.equal(body.variables.order.financialStatus,'PAID');
  assert.equal(body.variables.order.lineItems[0].quantity,2);
  assert.ok(body.variables.order.tags.includes('gift-signal-draft-draft-1'));
  assert.equal(result.providerOrderId,'gid://shopify/Order/999');
});


test('Shopify pricing quote uses scoped vault token and live variant data',async()=>{
  const vault=new FakeVault();
  const key={companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'};
  await vault.save(key,{
    provider:'shopify',externalAccountId:'example-shop.myshopify.com',
    accessToken:'shopify-scoped',refreshToken:'r',tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z'
  });
  let seenToken='';
  const runtime=new VaultBackedProviderRuntime(vault,{SHOPIFY_ADMIN_API_VERSION:'2026-10'});
  const quote=await runtime.quoteVariants(key,{
    lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:2}],
    fetchImpl:async(_url,init)=>{
      seenToken=String(init.headers['x-shopify-access-token']);
      return new Response(JSON.stringify({
        data:{
          shop:{currencyCode:'USD'},
          nodes:[{id:'gid://shopify/ProductVariant/123',price:'19.99',availableForSale:true,inventoryQuantity:4}]
        }
      }),{status:200});
    }
  });
  assert.equal(seenToken,'shopify-scoped');
  assert.equal(quote.currency,'USD');
  assert.equal(quote.lines[0].unitPrice,'19.99');
  assert.equal(quote.lines[0].inventoryQuantity,4);
});

test('Shopify pricing quote rejects unavailable or insufficient inventory',async()=>{
  const vault=new FakeVault();
  const key={companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'};
  await vault.save(key,{
    provider:'shopify',externalAccountId:'example-shop.myshopify.com',
    accessToken:'shopify-scoped',refreshToken:'r',tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z'
  });
  const runtime=new VaultBackedProviderRuntime(vault,{});
  await assert.rejects(
    runtime.quoteVariants(key,{
      lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:2}],
      fetchImpl:async()=>new Response(JSON.stringify({
        data:{shop:{currencyCode:'USD'},nodes:[{id:'gid://shopify/ProductVariant/123',price:'19.99',availableForSale:true,inventoryQuantity:1}]}
      }),{status:200})
    }),
    /provider_pricing_inventory_insufficient/
  );
});


test('Shopify landed quote uses only the tenant-scoped vault token',async()=>{
  const vault=new FakeVault();
  const key={companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'};
  await vault.save(key,{
    provider:'shopify',externalAccountId:key.externalAccountId,accessToken:'scoped-shopify',
    refreshToken:'r',tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z'
  });
  let calls=0;
  const runtime=new VaultBackedProviderRuntime(vault,{SHOPIFY_ADMIN_API_VERSION:'2026-10'});
  const result=await runtime.quoteLandedTotal(key,{
    lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}],
    shippingAddress:{address1:'123 Main St',city:'Atlanta',countryCode:'US',zip:'30303'},
    fetchImpl:async(_url,init)=>{
      calls++;
      assert.equal(init.headers['x-shopify-access-token'],'scoped-shopify');
      const final=calls===2;
      return new Response(JSON.stringify({data:{draftOrderCalculate:{userErrors:[],calculatedDraftOrder:{
        currencyCode:'USD',
        subtotalPriceSet:{shopMoney:{amount:'20.00',currencyCode:'USD'}},
        totalTaxSet:{shopMoney:{amount:final?'2.00':'1.50',currencyCode:'USD'}},
        totalShippingPriceSet:{shopMoney:{amount:final?'5.00':'0.00',currencyCode:'USD'}},
        totalPriceSet:{shopMoney:{amount:final?'27.00':'21.50',currencyCode:'USD'}},
        availableShippingRates:final?[]:[{handle:'ground',title:'Ground',price:{amount:'5.00',currencyCode:'USD'}}]
      }}}}),{status:200});
    }
  });
  assert.equal(result.total,'27.00');
  assert.equal(calls,2);
});


test('Shopify draft order lifecycle uses scoped vault token and verifies authoritative totals',async()=>{
  const vault=new FakeVault();
  const key={companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'};
  await vault.save(key,{
    provider:'shopify',externalAccountId:key.externalAccountId,accessToken:'scoped-shopify',
    refreshToken:'r',tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z'
  });
  const runtime=new VaultBackedProviderRuntime(vault,{SHOPIFY_ADMIN_API_VERSION:'2026-10'});
  let calls=0;
  const created=await runtime.createDraftOrder(key,{
    giftSignalDraftId:'draft-1',
    lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}],
    shippingAddress:{address1:'123 Main St',city:'Atlanta',provinceCode:'GA',countryCode:'US',zip:'30303'},
    landedQuote:{currency:'USD',subtotal:'100.00',tax:'8.60',shipping:{handle:'ground',title:'Ground',amount:'7.50'},total:'116.10'},
    fetchImpl:async(_url,init)=>{
      calls++;
      assert.equal(init.headers['x-shopify-access-token'],'scoped-shopify');
      const body=JSON.parse(String(init.body));
      assert.equal(body.variables.input.shippingLine.shippingRateHandle,'ground');
      assert.equal(body.variables.input.acceptAutomaticDiscounts,true);
      return new Response(JSON.stringify({data:{draftOrderCreate:{userErrors:[],draftOrder:{
        id:'gid://shopify/DraftOrder/55',
        subtotalPriceSet:{shopMoney:{amount:'100.0',currencyCode:'USD'}},
        totalTaxSet:{shopMoney:{amount:'8.60',currencyCode:'USD'}},
        totalPriceSet:{shopMoney:{amount:'116.10',currencyCode:'USD'}},
        shippingLine:{originalPriceSet:{shopMoney:{amount:'7.5',currencyCode:'USD'}}}
      }}}}),{status:200});
    }
  });
  assert.equal(created.draftOrderId,'gid://shopify/DraftOrder/55');
  assert.equal(calls,1);

  const completed=await runtime.completeDraftOrder(key,{
    draftOrderId:created.draftOrderId,
    fetchImpl:async(_url,init)=>{
      assert.equal(init.headers['x-shopify-access-token'],'scoped-shopify');
      const body=JSON.parse(String(init.body));
      assert.equal(body.variables.id,'gid://shopify/DraftOrder/55');
      return new Response(JSON.stringify({data:{draftOrderComplete:{userErrors:[],draftOrder:{
        id:'gid://shopify/DraftOrder/55',
        order:{id:'gid://shopify/Order/999'}
      }}}}),{status:200});
    }
  });
  assert.equal(completed.providerOrderId,'gid://shopify/Order/999');
});

test('Shopify draft order creation fails closed when Shopify recalculates a different total',async()=>{
  const vault=new FakeVault();
  const key={companyId:'org-a',provider:'shopify',externalAccountId:'example-shop.myshopify.com'};
  await vault.save(key,{
    provider:'shopify',externalAccountId:key.externalAccountId,accessToken:'scoped-shopify',
    refreshToken:'r',tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z'
  });
  const runtime=new VaultBackedProviderRuntime(vault,{});
  await assert.rejects(
    runtime.createDraftOrder(key,{
      giftSignalDraftId:'draft-2',
      lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}],
      shippingAddress:{address1:'123 Main St',city:'Atlanta',countryCode:'US',zip:'30303'},
      landedQuote:{currency:'USD',subtotal:'100.00',tax:'8.00',shipping:{handle:'ground',title:'Ground',amount:'5.00'},total:'113.00'},
      fetchImpl:async()=>new Response(JSON.stringify({data:{draftOrderCreate:{userErrors:[],draftOrder:{
        id:'gid://shopify/DraftOrder/56',
        subtotalPriceSet:{shopMoney:{amount:'100.00',currencyCode:'USD'}},
        totalTaxSet:{shopMoney:{amount:'9.00',currencyCode:'USD'}},
        totalPriceSet:{shopMoney:{amount:'114.00',currencyCode:'USD'}},
        shippingLine:{originalPriceSet:{shopMoney:{amount:'5.00',currencyCode:'USD'}}}
      }}}}),{status:200})
    }),
    /provider_draft_order_total_mismatch/
  );
});
