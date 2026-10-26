import {randomUUID} from 'node:crypto';
import type {ProviderTokenSet} from './provider-token-exchange.js';

async function parse(response:Response){
  const text=await response.text();
  let data:Record<string,unknown>;
  try{data=JSON.parse(text) as Record<string,unknown>;}catch{throw new Error('provider_refresh_invalid_json');}
  if(!response.ok) throw new Error('provider_refresh_failed');
  return data;
}

export async function refreshShopifyToken(args:{
  refreshToken:string;
  externalAccountId:string;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}):Promise<ProviderTokenSet>{
  const env=args.env??process.env;
  const clientId=env.SHOPIFY_CLIENT_ID;
  const clientSecret=env.SHOPIFY_CLIENT_SECRET;
  if(!clientId||!clientSecret) throw new Error('shopify_oauth_not_configured');
  const request=args.fetchImpl??fetch;
  const response=await request(`https://${args.externalAccountId}/admin/oauth/access_token`,{
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},
    body:new URLSearchParams({
      client_id:clientId,
      client_secret:clientSecret,
      grant_type:'refresh_token',
      refresh_token:args.refreshToken
    })
  });
  const token=await parse(response);
  const accessToken=String(token.access_token??'');
  const refreshToken=token.refresh_token?String(token.refresh_token):'';
  if(!accessToken||!refreshToken) throw new Error('shopify_refresh_token_missing');
  return {
    provider:'shopify',
    externalAccountId:args.externalAccountId,
    accessToken,
    refreshToken,
    tokenType:'Bearer',
    expiresAt:new Date(Date.now()+Number(token.expires_in??3600)*1000).toISOString(),
    scope:token.scope?String(token.scope):undefined
  };
}

export async function refreshWalmartToken(args:{
  refreshToken:string;
  sellerId:string;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}):Promise<ProviderTokenSet>{
  const env=args.env??process.env;
  const clientId=env.WALMART_CLIENT_ID;
  const clientSecret=env.WALMART_CLIENT_SECRET;
  if(!clientId||!clientSecret) throw new Error('walmart_oauth_not_configured');
  const request=args.fetchImpl??fetch;
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
    body:new URLSearchParams({grant_type:'refresh_token',refresh_token:args.refreshToken})
  });
  const token=await parse(response);
  return {
    provider:'walmart',
    externalAccountId:args.sellerId,
    accessToken:String(token.access_token??''),
    refreshToken:token.refresh_token?String(token.refresh_token):args.refreshToken,
    tokenType:String(token.token_type??'Bearer'),
    expiresAt:new Date(Date.now()+Number(token.expires_in??900)*1000).toISOString()
  };
}

export async function refreshEbayToken(args:{
  refreshToken:string;
  externalAccountId:string;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}):Promise<ProviderTokenSet>{
  const env=args.env??process.env;
  const clientId=env.EBAY_CLIENT_ID;
  const clientSecret=env.EBAY_CLIENT_SECRET;
  if(!clientId||!clientSecret) throw new Error('ebay_oauth_not_configured');
  const request=args.fetchImpl??fetch;
  const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:args.refreshToken});
  if(env.EBAY_OAUTH_SCOPES) body.set('scope',env.EBAY_OAUTH_SCOPES);
  const response=await request(env.EBAY_TOKEN_URL||'https://api.ebay.com/identity/v1/oauth2/token',{
    method:'POST',
    headers:{
      authorization:'Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64'),
      'content-type':'application/x-www-form-urlencoded'
    },
    body
  });
  const token=await parse(response);
  return {
    provider:'ebay',
    externalAccountId:args.externalAccountId,
    accessToken:String(token.access_token??''),
    refreshToken:args.refreshToken,
    tokenType:String(token.token_type??'Bearer'),
    expiresAt:new Date(Date.now()+Number(token.expires_in??7200)*1000).toISOString(),
    scope:token.scope?String(token.scope):undefined
  };
}

export async function refreshEtsyToken(args:{
  refreshToken:string;
  externalAccountId:string;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}):Promise<ProviderTokenSet>{
  const env=args.env??process.env;
  const clientId=env.ETSY_CLIENT_ID;
  if(!clientId) throw new Error('etsy_oauth_not_configured');
  const request=args.fetchImpl??fetch;
  const response=await request(env.ETSY_TOKEN_URL||'https://api.etsy.com/v3/public/oauth/token',{
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'refresh_token',client_id:clientId,refresh_token:args.refreshToken})
  });
  const token=await parse(response);
  return {
    provider:'etsy',
    externalAccountId:args.externalAccountId,
    accessToken:String(token.access_token??''),
    refreshToken:token.refresh_token?String(token.refresh_token):args.refreshToken,
    tokenType:String(token.token_type??'Bearer'),
    expiresAt:new Date(Date.now()+Number(token.expires_in??3600)*1000).toISOString(),
    scope:token.scope?String(token.scope):undefined
  };
}

export interface AmazonLwaToken {
  accessToken:string;
  tokenType:string;
  expiresAt:string;
  refreshToken:string;
}

export async function refreshAmazonLwaToken(args:{
  refreshToken:string;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}):Promise<AmazonLwaToken>{
  const env=args.env??process.env;
  const clientId=env.AMAZON_LWA_CLIENT_ID;
  const clientSecret=env.AMAZON_LWA_CLIENT_SECRET;
  if(!clientId||!clientSecret) throw new Error('amazon_lwa_not_configured');
  const request=args.fetchImpl??fetch;
  const response=await request(env.AMAZON_LWA_TOKEN_URL||'https://api.amazon.com/auth/o2/token',{
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body:new URLSearchParams({
      grant_type:'refresh_token',
      refresh_token:args.refreshToken,
      client_id:clientId,
      client_secret:clientSecret
    })
  });
  const token=await parse(response);
  return {
    accessToken:String(token.access_token??''),
    tokenType:String(token.token_type??'bearer'),
    expiresAt:new Date(Date.now()+Number(token.expires_in??3600)*1000).toISOString(),
    refreshToken:token.refresh_token?String(token.refresh_token):args.refreshToken
  };
}
