import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProviderAuthorization,createPkcePair} from '../dist/provider-oauth.js';
import {exchangeProviderAuthorizationCode} from '../dist/provider-token-exchange.js';
import {refreshAmazonLwaToken,refreshEtsyToken,refreshShopifyToken,refreshWalmartToken} from '../dist/provider-refresh.js';

const stateEnv={PROVIDER_OAUTH_STATE_SECRET:'abcdefghijklmnopqrstuvwxyz123456'};

test('Etsy authorization requires PKCE and emits S256 challenge',()=>{
  const pkce=createPkcePair();
  assert.ok(pkce.verifier.length>=43);
  const result=buildProviderAuthorization({
    provider:'etsy',
    companyId:'co-1',
    redirectUri:'https://app.example/callback',
    pkceChallenge:pkce.challenge,
    env:{...stateEnv,ETSY_CLIENT_ID:'example-client',ETSY_OAUTH_SCOPES:'shops_r listings_r'}
  });
  const url=new URL(result.authorizationUrl);
  assert.equal(url.origin,'https://www.etsy.com');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('code_challenge'),pkce.challenge);
});

test('Etsy exchanges authorization code with code verifier',async()=>{
  let body='';
  const token=await exchangeProviderAuthorizationCode({
    provider:'etsy',
    code:'example-code',
    codeVerifier:'example-verifier',
    redirectUri:'https://app.example/callback',
    fetchImpl:async(_url,init)=>{
      body=String(init?.body??'');
      return new Response(JSON.stringify({
        access_token:'12345.example-access',
        refresh_token:'12345.example-refresh',
        token_type:'Bearer',
        expires_in:3600,
        scope:'shops_r listings_r'
      }),{status:200});
    },
    env:{ETSY_CLIENT_ID:'example-client'}
  });
  assert.equal(token.externalAccountId,'12345');
  assert.match(body,/code_verifier=example-verifier/);
});

test('refreshes Walmart access token with seller-bound refresh grant',async()=>{
  let body='';
  const token=await refreshWalmartToken({
    refreshToken:'example-refresh',
    sellerId:'seller-1',
    fetchImpl:async(_url,init)=>{
      body=String(init?.body??'');
      return new Response(JSON.stringify({access_token:'new-access',token_type:'Bearer',expires_in:900}),{status:200});
    },
    env:{WALMART_CLIENT_ID:'example-client',WALMART_CLIENT_SECRET:'example-secret'}
  });
  assert.equal(token.externalAccountId,'seller-1');
  assert.match(body,/grant_type=refresh_token/);
});

test('refreshes Etsy token without re-consent',async()=>{
  const token=await refreshEtsyToken({
    refreshToken:'example-refresh',
    externalAccountId:'12345',
    fetchImpl:async()=>new Response(JSON.stringify({
      access_token:'12345.new-access',
      refresh_token:'12345.new-refresh',
      token_type:'Bearer',
      expires_in:3600
    }),{status:200}),
    env:{ETSY_CLIENT_ID:'example-client'}
  });
  assert.equal(token.provider,'etsy');
  assert.equal(token.refreshToken,'12345.new-refresh');
});

test('Amazon SP-API obtains short-lived LWA access token from refresh token',async()=>{
  let body='';
  const token=await refreshAmazonLwaToken({
    refreshToken:'example-refresh',
    fetchImpl:async(_url,init)=>{
      body=String(init?.body??'');
      return new Response(JSON.stringify({
        access_token:'amazon-access',
        refresh_token:'example-refresh',
        token_type:'bearer',
        expires_in:3600
      }),{status:200});
    },
    env:{AMAZON_LWA_CLIENT_ID:'example-client',AMAZON_LWA_CLIENT_SECRET:'example-secret'}
  });
  assert.equal(token.accessToken,'amazon-access');
  assert.match(body,/grant_type=refresh_token/);
});

test('Etsy exchange fails closed when access token has no verifiable user id',async()=>{
  await assert.rejects(
    exchangeProviderAuthorizationCode({
      provider:'etsy',
      code:'example-code',
      codeVerifier:'example-verifier',
      redirectUri:'https://app.example/callback',
      fetchImpl:async()=>new Response(JSON.stringify({
        access_token:'opaque-access-token',
        refresh_token:'opaque-refresh',
        token_type:'Bearer',
        expires_in:3600
      }),{status:200}),
      env:{ETSY_CLIENT_ID:'example-client'}
    }),
    /etsy_oauth_user_id_missing/
  );
});


test('Shopify exchanges authorization code for expiring offline credentials',async()=>{
  let body='';
  const token=await exchangeProviderAuthorizationCode({
    provider:'shopify',
    code:'shopify-code',
    shopDomain:'example-shop.myshopify.com',
    redirectUri:'https://app.example/callback',
    fetchImpl:async(url,init)=>{
      const href=String(url);
      if(href==='https://example-shop.myshopify.com/admin/oauth/access_token'){
        body=String(init?.body??'');
        return new Response(JSON.stringify({
          access_token:'shopify-access',
          refresh_token:'shopify-refresh',
          expires_in:3600,
          scope:'read_products,read_orders'
        }),{status:200});
      }
      assert.equal(href,'https://example-shop.myshopify.com/admin/api/2026-10/graphql.json');
      assert.equal(String(init?.headers?.['x-shopify-access-token']),'shopify-access');
      return new Response(JSON.stringify({
        data:{shop:{myshopifyDomain:'example-shop.myshopify.com'}}
      }),{status:200});
    },
    env:{SHOPIFY_CLIENT_ID:'shopify-client',SHOPIFY_CLIENT_SECRET:'shopify-secret'}
  });
  assert.equal(token.provider,'shopify');
  assert.equal(token.externalAccountId,'example-shop.myshopify.com');
  assert.match(body,/expiring=1/);
});

test('Shopify refresh rotates expiring offline credentials',async()=>{
  let body='';
  const token=await refreshShopifyToken({
    refreshToken:'shopify-refresh',
    externalAccountId:'example-shop.myshopify.com',
    fetchImpl:async(url,init)=>{
      assert.equal(String(url),'https://example-shop.myshopify.com/admin/oauth/access_token');
      body=String(init?.body??'');
      return new Response(JSON.stringify({
        access_token:'shopify-access-2',
        refresh_token:'shopify-refresh-2',
        expires_in:3600,
        scope:'read_products'
      }),{status:200});
    },
    env:{SHOPIFY_CLIENT_ID:'shopify-client',SHOPIFY_CLIENT_SECRET:'shopify-secret'}
  });
  assert.equal(token.refreshToken,'shopify-refresh-2');
  assert.match(body,/grant_type=refresh_token/);
});
