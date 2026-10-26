import {randomUUID} from 'node:crypto';
import type {OAuthProvider} from './provider-oauth.js';
import {resolveEbayAccountId,resolveShopifyShopDomain} from './provider-account-identity.js';

export interface ProviderTokenSet {
  provider:OAuthProvider;
  externalAccountId:string;
  accessToken:string;
  refreshToken?:string;
  tokenType:string;
  expiresAt:string;
  scope?:string;
}

async function parseJsonResponse(response:Response){
  const body=await response.text();
  let parsed:Record<string,unknown>;
  try{parsed=JSON.parse(body) as Record<string,unknown>;}catch{throw new Error('provider_oauth_invalid_json');}
  if(!response.ok) throw new Error('provider_oauth_exchange_failed');
  return parsed;
}

export async function exchangeProviderAuthorizationCode(args:{
  provider:OAuthProvider;
  code:string;
  redirectUri:string;
  sellerId?:string;
  shopDomain?:string;
  codeVerifier?:string;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}):Promise<ProviderTokenSet>{
  const env=args.env??process.env;
  const request=args.fetchImpl??fetch;

  if(args.provider==='shopify'){
    const clientId=env.SHOPIFY_CLIENT_ID;
    const clientSecret=env.SHOPIFY_CLIENT_SECRET;
    const shopDomain=args.shopDomain?.trim().toLowerCase();
    if(!clientId||!clientSecret||!shopDomain) throw new Error('shopify_oauth_not_configured');
    const response=await request(`https://${shopDomain}/admin/oauth/access_token`,{
      method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},
      body:new URLSearchParams({
        client_id:clientId,
        client_secret:clientSecret,
        code:args.code,
        expiring:'1'
      })
    });
    const token=await parseJsonResponse(response);
    const accessToken=String(token.access_token??'');
    const refreshToken=token.refresh_token?String(token.refresh_token):undefined;
    if(!accessToken||!refreshToken) throw new Error('shopify_oauth_token_missing');
    const externalAccountId=await resolveShopifyShopDomain({
      shopDomain,
      accessToken,
      fetchImpl:args.fetchImpl,
      env
    });
    return {
      provider:'shopify',
      externalAccountId,
      accessToken,
      refreshToken,
      tokenType:'Bearer',
      expiresAt:new Date(Date.now()+Number(token.expires_in??3600)*1000).toISOString(),
      scope:token.scope?String(token.scope):undefined
    };
  }

  if(args.provider==='walmart'){
    const clientId=env.WALMART_CLIENT_ID;
    const clientSecret=env.WALMART_CLIENT_SECRET;
    if(!clientId||!clientSecret||!args.sellerId) throw new Error('walmart_oauth_not_configured');
    const response=await request(env.WALMART_TOKEN_URL||'https://marketplace.walmartapis.com/v3/token',{
      method:'POST',
      headers:{
        authorization:'Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64'),
        'content-type':'application/x-www-form-urlencoded',
        accept:'application/json',
        'wm-partner.id':args.sellerId,
        'wm-qos.correlation_id':randomUUID(),
        'wm-svc.name':'Walmart Marketplace'
      },
      body:new URLSearchParams({grant_type:'authorization_code',code:args.code,redirect_uri:args.redirectUri})
    });
    const token=await parseJsonResponse(response);
    return {
      provider:'walmart',
      externalAccountId:args.sellerId,
      accessToken:String(token.access_token??''),
      refreshToken:token.refresh_token?String(token.refresh_token):undefined,
      tokenType:String(token.token_type??'Bearer'),
      expiresAt:new Date(Date.now()+Number(token.expires_in??900)*1000).toISOString()
    };
  }

  if(args.provider==='etsy'){
    const clientId=env.ETSY_CLIENT_ID;
    if(!clientId||!args.codeVerifier) throw new Error('etsy_oauth_not_configured');
    const response=await request(env.ETSY_TOKEN_URL||'https://api.etsy.com/v3/public/oauth/token',{
      method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({
        grant_type:'authorization_code',
        client_id:clientId,
        redirect_uri:args.redirectUri,
        code:args.code,
        code_verifier:args.codeVerifier
      })
    });
    const token=await parseJsonResponse(response);
    const accessToken=String(token.access_token??'');
    if(!accessToken) throw new Error('etsy_oauth_access_token_missing');
    const externalAccountId=accessToken.includes('.')?accessToken.split('.')[0]:'';
    if(!externalAccountId) throw new Error('etsy_oauth_user_id_missing');
    return {
      provider:'etsy',
      externalAccountId,
      accessToken,
      refreshToken:token.refresh_token?String(token.refresh_token):undefined,
      tokenType:String(token.token_type??'Bearer'),
      expiresAt:new Date(Date.now()+Number(token.expires_in??3600)*1000).toISOString(),
      scope:token.scope?String(token.scope):undefined
    };
  }

  const clientId=env.EBAY_CLIENT_ID;
  const clientSecret=env.EBAY_CLIENT_SECRET;
  if(!clientId||!clientSecret) throw new Error('ebay_oauth_not_configured');
  const response=await request(env.EBAY_TOKEN_URL||'https://api.ebay.com/identity/v1/oauth2/token',{
    method:'POST',
    headers:{
      authorization:'Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64'),
      'content-type':'application/x-www-form-urlencoded'
    },
    body:new URLSearchParams({grant_type:'authorization_code',code:args.code,redirect_uri:args.redirectUri})
  });
  const token=await parseJsonResponse(response);
  const accessToken=String(token.access_token??'');
  if(!accessToken) throw new Error('ebay_oauth_access_token_missing');
  const externalAccountId=await resolveEbayAccountId({
    accessToken,
    fetchImpl:args.fetchImpl,
    env
  });
  return {
    provider:'ebay',
    externalAccountId,
    accessToken,
    refreshToken:token.refresh_token?String(token.refresh_token):undefined,
    tokenType:String(token.token_type??'Bearer'),
    expiresAt:new Date(Date.now()+Number(token.expires_in??7200)*1000).toISOString(),
    scope:token.scope?String(token.scope):undefined
  };
}
