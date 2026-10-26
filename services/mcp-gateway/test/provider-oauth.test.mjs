import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProviderAuthorization,
  exchangeProviderAuthorizationCode,
  issueProviderState,
  verifyProviderState,
  syncEbayInventory,
  syncWalmartCatalog
} from '../dist/provider-oauth.js';

const stateEnv={PROVIDER_OAUTH_STATE_SECRET:'12345678901234567890123456789012'};

test('provider OAuth state is signed and tamper evident',()=>{
  const token=issueProviderState({provider:'ebay',companyId:'co-1',redirectUri:'https://app.example/callback'},stateEnv);
  const parsed=verifyProviderState(token,600000,stateEnv);
  assert.equal(parsed.companyId,'co-1');
  assert.throws(()=>verifyProviderState(token+'x',600000,stateEnv),/invalid_provider_oauth_state/);
});

test('builds current eBay authorization-code consent URL',()=>{
  const result=buildProviderAuthorization({
    provider:'ebay',companyId:'co-1',redirectUri:'https://app.example/callback',
    env:{...stateEnv,EBAY_CLIENT_ID:'client',EBAY_OAUTH_SCOPES:'scope-a scope-b'}
  });
  const url=new URL(result.authorizationUrl);
  assert.equal(url.origin,'https://auth.ebay.com');
  assert.equal(url.searchParams.get('client_id'),'client');
  assert.equal(url.searchParams.get('response_type'),'code');
});

test('builds Walmart seller authorization URL with nonce and state',()=>{
  const result=buildProviderAuthorization({
    provider:'walmart',companyId:'co-1',redirectUri:'https://app.example/callback',
    env:{...stateEnv,WALMART_CLIENT_ID:'client'}
  });
  const url=new URL(result.authorizationUrl);
  assert.equal(url.origin,'https://login.account.wal-mart.com');
  assert.equal(url.searchParams.get('responseType'),'code');
  assert.ok(url.searchParams.get('nonce'));
  assert.ok(url.searchParams.get('state'));
});

test('exchanges Walmart authorization code without exposing client secret',async()=>{
  let captured;
  const fetchImpl=async(url,init)=>{
    captured={url:String(url),init};
    return new Response(JSON.stringify({access_token:'access',refresh_token:'refresh',token_type:'Bearer',expires_in:900}),{status:200});
  };
  const token=await exchangeProviderAuthorizationCode({
    provider:'walmart',code:'code',sellerId:'seller-1',redirectUri:'https://app.example/callback',
    fetchImpl,env:{WALMART_CLIENT_ID:'client',WALMART_CLIENT_SECRET:'secret'}
  });
  assert.equal(token.externalAccountId,'seller-1');
  assert.equal(token.accessToken,'access');
  assert.match(captured.init.headers.authorization,/^Basic /);
  assert.equal(String(captured.init.body).includes('secret'),false);
});

test('normalizes Walmart catalog and eBay inventory responses',async()=>{
  const walmart=await syncWalmartCatalog({
    accessToken:'token',
    fetchImpl:async()=>new Response(JSON.stringify({items:[{sku:'W1',productName:'Camera',price:{amount:99,currency:'USD'},publishedStatus:'PUBLISHED'}]}),{status:200})
  });
  assert.deepEqual(walmart[0].sku,'W1');
  assert.equal(walmart[0].price,99);

  const ebay=await syncEbayInventory({
    accessToken:'token',
    fetchImpl:async()=>new Response(JSON.stringify({inventoryItems:[{sku:'E1',condition:'NEW',product:{title:'Headphones'},availability:{shipToLocationAvailability:{quantity:4}}}]}),{status:200})
  });
  assert.equal(ebay[0].title,'Headphones');
  assert.equal(ebay[0].quantity,4);
});
