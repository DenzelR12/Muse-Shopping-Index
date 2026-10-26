import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteShopifyVariants,decimalPriceToMinorUnits,quoteTotalMinorUnits,quoteTotalAmount} from '../dist/provider-pricing.js';

test('Shopify variant quote reads live price availability and inventory',async()=>{
  let seenUrl='';
  let seenToken='';
  let seenBody;
  const quote=await quoteShopifyVariants({
    shopDomain:'example-shop.myshopify.com',
    accessToken:'shopify-token',
    lineItems:[
      {variantId:'gid://shopify/ProductVariant/123',quantity:2},
      {variantId:'gid://shopify/ProductVariant/456',quantity:1}
    ],
    env:{SHOPIFY_ADMIN_API_VERSION:'2026-10'},
    fetchImpl:async(url,init)=>{
      seenUrl=String(url);
      seenToken=String(init.headers['x-shopify-access-token']);
      seenBody=JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        data:{
          shop:{currencyCode:'USD'},
          nodes:[
            {id:'gid://shopify/ProductVariant/123',price:'19.99',availableForSale:true,inventoryQuantity:5},
            {id:'gid://shopify/ProductVariant/456',price:'10.00',availableForSale:true,inventoryQuantity:null}
          ]
        }
      }),{status:200,headers:{'content-type':'application/json'}});
    }
  });
  assert.equal(seenUrl,'https://example-shop.myshopify.com/admin/api/2026-10/graphql.json');
  assert.equal(seenToken,'shopify-token');
  assert.deepEqual(seenBody.variables.ids,[
    'gid://shopify/ProductVariant/123',
    'gid://shopify/ProductVariant/456'
  ]);
  assert.equal(quote.currency,'USD');
  assert.equal(quote.lines.length,2);
  assert.equal(quote.lines[0].unitPrice,'19.99');
  assert.equal(quote.lines[0].inventoryQuantity,5);
  assert.equal(quoteTotalMinorUnits(quote),4998);
  assert.equal(quoteTotalAmount(quote),49.98);
});

test('minor-unit conversion follows currency fraction digits without floating point rounding',()=>{
  assert.equal(decimalPriceToMinorUnits('19.99','USD'),1999);
  assert.equal(decimalPriceToMinorUnits('125','JPY'),125);
  assert.equal(decimalPriceToMinorUnits('1.234','KWD'),1234);
  assert.throws(()=>decimalPriceToMinorUnits('1.999','USD'),/provider_pricing_precision_unsupported/);
});

test('quote fails closed when Shopify marks variant unavailable',async()=>{
  await assert.rejects(
    quoteShopifyVariants({
      shopDomain:'example-shop.myshopify.com',
      accessToken:'shopify-token',
      lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}],
      fetchImpl:async()=>new Response(JSON.stringify({
        data:{
          shop:{currencyCode:'USD'},
          nodes:[{id:'gid://shopify/ProductVariant/123',price:'19.99',availableForSale:false,inventoryQuantity:5}]
        }
      }),{status:200,headers:{'content-type':'application/json'}})
    }),
    /provider_pricing_variant_unavailable/
  );
});

test('quote fails closed when inventory is known and insufficient',async()=>{
  await assert.rejects(
    quoteShopifyVariants({
      shopDomain:'example-shop.myshopify.com',
      accessToken:'shopify-token',
      lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:3}],
      fetchImpl:async()=>new Response(JSON.stringify({
        data:{
          shop:{currencyCode:'USD'},
          nodes:[{id:'gid://shopify/ProductVariant/123',price:'19.99',availableForSale:true,inventoryQuantity:2}]
        }
      }),{status:200,headers:{'content-type':'application/json'}})
    }),
    /provider_pricing_inventory_insufficient/
  );
});

test('quote rejects missing or mismatched variant nodes',async()=>{
  await assert.rejects(
    quoteShopifyVariants({
      shopDomain:'example-shop.myshopify.com',
      accessToken:'shopify-token',
      lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}],
      fetchImpl:async()=>new Response(JSON.stringify({
        data:{shop:{currencyCode:'USD'},nodes:[]}
      }),{status:200,headers:{'content-type':'application/json'}})
    }),
    /provider_pricing_missing_fields/
  );
});


test('quote total stays in major units for approval and policy comparisons across currency exponents',()=>{
  assert.equal(quoteTotalAmount({currency:'JPY',lines:[{variantId:'gid://shopify/ProductVariant/1',quantity:2,unitPrice:'125',availableForSale:true,inventoryQuantity:5}]}),250);
  assert.equal(quoteTotalAmount({currency:'KWD',lines:[{variantId:'gid://shopify/ProductVariant/1',quantity:2,unitPrice:'1.234',availableForSale:true,inventoryQuantity:5}]}),2.468);
});


test('Shopify landed quote selects the cheapest available shipping rate and returns full total',async()=>{
  const {quoteShopifyLandedTotal,landedQuoteTotalAmount}=await import('../dist/provider-landed-quote.js');
  let calls=0;
  const quote=await quoteShopifyLandedTotal({
    shopDomain:'example-shop.myshopify.com',
    accessToken:'shopify-token',
    lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}],
    shippingAddress:{address1:'123 Main St',city:'Atlanta',provinceCode:'GA',countryCode:'US',zip:'30303'},
    env:{SHOPIFY_ADMIN_API_VERSION:'2026-10'},
    fetchImpl:async(_url,init)=>{
      calls++;
      const body=JSON.parse(String(init.body));
      assert.equal(init.headers['x-shopify-access-token'],'shopify-token');
      if(calls===1){
        assert.equal(body.variables.input.shippingLine,undefined);
        return new Response(JSON.stringify({data:{draftOrderCalculate:{userErrors:[],calculatedDraftOrder:{
          currencyCode:'USD',
          subtotalPriceSet:{shopMoney:{amount:'100.00',currencyCode:'USD'}},
          totalTaxSet:{shopMoney:{amount:'8.00',currencyCode:'USD'}},
          totalShippingPriceSet:{shopMoney:{amount:'0.00',currencyCode:'USD'}},
          totalPriceSet:{shopMoney:{amount:'108.00',currencyCode:'USD'}},
          availableShippingRates:[
            {handle:'express',title:'Express',price:{amount:'20.00',currencyCode:'USD'}},
            {handle:'ground',title:'Ground',price:{amount:'7.50',currencyCode:'USD'}}
          ]
        }}}}),{status:200});
      }
      assert.equal(body.variables.input.shippingLine.shippingRateHandle,'ground');
      return new Response(JSON.stringify({data:{draftOrderCalculate:{userErrors:[],calculatedDraftOrder:{
        currencyCode:'USD',
        subtotalPriceSet:{shopMoney:{amount:'100.00',currencyCode:'USD'}},
        totalTaxSet:{shopMoney:{amount:'8.60',currencyCode:'USD'}},
        totalShippingPriceSet:{shopMoney:{amount:'7.50',currencyCode:'USD'}},
        totalPriceSet:{shopMoney:{amount:'116.10',currencyCode:'USD'}},
        availableShippingRates:[]
      }}}}),{status:200});
    }
  });
  assert.equal(calls,2);
  assert.deepEqual(quote,{
    currency:'USD',
    subtotal:'100.00',
    tax:'8.60',
    shipping:{handle:'ground',title:'Ground',amount:'7.50'},
    total:'116.10'
  });
  assert.equal(landedQuoteTotalAmount(quote),116.10);
});

test('Shopify landed quote fails closed when no shipping rate is available',async()=>{
  const {quoteShopifyLandedTotal}=await import('../dist/provider-landed-quote.js');
  await assert.rejects(
    quoteShopifyLandedTotal({
      shopDomain:'example-shop.myshopify.com',
      accessToken:'shopify-token',
      lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}],
      shippingAddress:{address1:'123 Main St',city:'Atlanta',countryCode:'US',zip:'30303'},
      fetchImpl:async()=>new Response(JSON.stringify({data:{draftOrderCalculate:{userErrors:[],calculatedDraftOrder:{
        currencyCode:'USD',
        subtotalPriceSet:{shopMoney:{amount:'100.00',currencyCode:'USD'}},
        totalTaxSet:{shopMoney:{amount:'0.00',currencyCode:'USD'}},
        totalShippingPriceSet:{shopMoney:{amount:'0.00',currencyCode:'USD'}},
        totalPriceSet:{shopMoney:{amount:'100.00',currencyCode:'USD'}},
        availableShippingRates:[]
      }}}}),{status:200})
    }),
    /provider_landed_quote_shipping_unavailable/
  );
});
