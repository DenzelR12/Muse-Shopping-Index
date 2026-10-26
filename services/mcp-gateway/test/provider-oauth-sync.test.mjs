import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProviderAuthorization,
  issueProviderState,
  verifyProviderState,
  verifyShopifyOAuthCallback
} from '../dist/provider-oauth.js';
import {
  syncEbayInventory,
  syncWalmartCatalog,
  syncWalmartInventory
} from '../dist/provider-sync.js';
import {resolveEbayAccountId,resolveEtsyShopId,resolveShopifyShopDomain} from '../dist/provider-account-identity.js';

const stateEnv={PROVIDER_OAUTH_STATE_SECRET:'abcdefghijklmnopqrstuvwxyz123456'};

test('provider OAuth state is signed and tamper evident',()=>{
  const token=issueProviderState({provider:'ebay',companyId:'co-1',redirectUri:'https://app.example/callback'},stateEnv);
  const parsed=verifyProviderState(token,600000,stateEnv);
  assert.equal(parsed.companyId,'co-1');
  assert.throws(()=>verifyProviderState(token+'x',600000,stateEnv),/invalid_provider_oauth_state/);
});

test('builds eBay authorization-code consent URL',()=>{
  const result=buildProviderAuthorization({
    provider:'ebay',
    companyId:'co-1',
    redirectUri:'https://app.example/callback',
    env:{...stateEnv,EBAY_CLIENT_ID:'example-client',EBAY_OAUTH_SCOPES:'scope-a scope-b'}
  });
  const url=new URL(result.authorizationUrl);
  assert.equal(url.origin,'https://auth.ebay.com');
  assert.equal(url.searchParams.get('response_type'),'code');
  assert.equal(url.searchParams.get('client_id'),'example-client');
});

test('builds Walmart seller authorization URL with nonce and state',()=>{
  const result=buildProviderAuthorization({
    provider:'walmart',
    companyId:'co-1',
    redirectUri:'https://app.example/callback',
    env:{...stateEnv,WALMART_CLIENT_ID:'example-client'}
  });
  const url=new URL(result.authorizationUrl);
  assert.equal(url.origin,'https://login.account.wal-mart.com');
  assert.equal(url.searchParams.get('responseType'),'code');
  assert.ok(url.searchParams.get('nonce'));
  assert.ok(url.searchParams.get('state'));
});

test('normalizes Walmart catalog and inventory responses',async()=>{
  const catalog=await syncWalmartCatalog({
    accessToken:'test-value',
    fetchImpl:async()=>new Response(JSON.stringify({items:[{sku:'W1',productName:'Camera',price:{amount:99,currency:'USD'},publishedStatus:'PUBLISHED'}]}),{status:200})
  });
  assert.equal(catalog[0].sku,'W1');
  assert.equal(catalog[0].price,99);

  const inventory=await syncWalmartInventory({
    accessToken:'test-value',
    fetchImpl:async()=>new Response(JSON.stringify({items:[{sku:'W1',quantity:{amount:7}}]}),{status:200})
  });
  assert.equal(inventory[0].quantity,7);
});

test('normalizes eBay inventory responses',async()=>{
  const rows=await syncEbayInventory({
    accessToken:'test-value',
    fetchImpl:async()=>new Response(JSON.stringify({inventoryItems:[{sku:'E1',condition:'NEW',product:{title:'Headphones'},availability:{shipToLocationAvailability:{quantity:4}}}]}),{status:200})
  });
  assert.equal(rows[0].title,'Headphones');
  assert.equal(rows[0].quantity,4);
});

test('resolves eBay account id from authenticated Identity API',async()=>{
  let auth='';
  const accountId=await resolveEbayAccountId({
    accessToken:'ebay-access',
    fetchImpl:async(_url,init)=>{
      auth=String(init.headers.authorization);
      return new Response(JSON.stringify({userId:'seller-42'}),{status:200});
    }
  });
  assert.equal(accountId,'seller-42');
  assert.equal(auth,'Bearer ebay-access');
});

test('resolves Etsy shop id from OAuth user id without changing credential identity',async()=>{
  let seen='';
  const shopId=await resolveEtsyShopId({
    userId:'12345678',
    apiKey:'etsy-key',
    fetchImpl:async(url,init)=>{
      seen=String(url);
      assert.equal(init.headers['x-api-key'],'etsy-key');
      return new Response(JSON.stringify({shop_id:98765,user_id:12345678}),{status:200});
    }
  });
  assert.equal(shopId,'98765');
  assert.match(seen,/\/users\/12345678\/shops$/);
});

test('provider identity resolvers fail closed when provider identity is absent',async()=>{
  await assert.rejects(
    resolveEbayAccountId({
      accessToken:'ebay-access',
      fetchImpl:async()=>new Response(JSON.stringify({}),{status:200})
    }),
    /ebay_identity_missing_user_id/
  );
  await assert.rejects(
    resolveEtsyShopId({
      userId:'123',
      apiKey:'etsy-key',
      fetchImpl:async()=>new Response(JSON.stringify({}),{status:200})
    }),
    /etsy_shop_identity_missing_shop_id/
  );
});


test('builds Shopify standalone authorization URL for a canonical shop',()=>{
  const result=buildProviderAuthorization({
    provider:'shopify',
    companyId:'co-1',
    redirectUri:'https://app.example/callback',
    shopDomain:'Example-Shop.myshopify.com',
    env:{...stateEnv,SHOPIFY_CLIENT_ID:'shopify-client',SHOPIFY_OAUTH_SCOPES:'read_products,read_orders'}
  });
  const url=new URL(result.authorizationUrl);
  assert.equal(url.origin,'https://example-shop.myshopify.com');
  assert.equal(url.pathname,'/admin/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'),'shopify-client');
  assert.equal(url.searchParams.get('scope'),'read_products,read_orders');
  const state=verifyProviderState(url.searchParams.get('state'),600000,stateEnv);
  assert.equal(state.shopDomain,'example-shop.myshopify.com');
});

test('Shopify callback verifier rejects invalid shop hosts and accepts valid HMAC',async()=>{
  const env={SHOPIFY_CLIENT_SECRET:'shopify-secret'};
  const callback=new URL('https://app.example/callback?code=abc&shop=example-shop.myshopify.com&state=state&timestamp=1700000000');
  const {createHmac}=await import('node:crypto');
  const message=[...callback.searchParams.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('&');
  callback.searchParams.set('hmac',createHmac('sha256',env.SHOPIFY_CLIENT_SECRET).update(message).digest('hex'));
  assert.equal(verifyShopifyOAuthCallback(callback,'example-shop.myshopify.com',env),'example-shop.myshopify.com');
  assert.throws(()=>verifyShopifyOAuthCallback(callback,'other.myshopify.com',env),/shopify_oauth_shop_mismatch/);
});


test('resolves Shopify shop identity from authenticated Admin GraphQL API',async()=>{
  let seenUrl='';
  let seenToken='';
  const shop=await resolveShopifyShopDomain({
    shopDomain:'Example-Shop.myshopify.com',
    accessToken:'shopify-access',
    fetchImpl:async(url,init)=>{
      seenUrl=String(url);
      seenToken=String(init.headers['x-shopify-access-token']);
      return new Response(JSON.stringify({
        data:{shop:{myshopifyDomain:'example-shop.myshopify.com'}}
      }),{status:200});
    }
  });
  assert.equal(shop,'example-shop.myshopify.com');
  assert.match(seenUrl,/example-shop\.myshopify\.com\/admin\/api\/2026-10\/graphql\.json$/);
  assert.equal(seenToken,'shopify-access');
});

test('Shopify shop identity verification fails closed on provider mismatch',async()=>{
  await assert.rejects(
    resolveShopifyShopDomain({
      shopDomain:'example-shop.myshopify.com',
      accessToken:'shopify-access',
      fetchImpl:async()=>new Response(JSON.stringify({
        data:{shop:{myshopifyDomain:'other-shop.myshopify.com'}}
      }),{status:200})
    }),
    /shopify_shop_identity_mismatch/
  );
});
