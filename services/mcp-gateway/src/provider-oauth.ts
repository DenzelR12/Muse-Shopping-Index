import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

export type OAuthProvider='walmart'|'ebay'|'etsy'|'shopify';

export interface ProviderOAuthState {
  provider:OAuthProvider;
  companyId:string;
  issuedAt:number;
  redirectUri:string;
  shopDomain?:string;
}

const encode=(value:string)=>Buffer.from(value).toString('base64url');
const decode=(value:string)=>Buffer.from(value,'base64url').toString('utf8');

function stateSecret(env:NodeJS.ProcessEnv=process.env){
  const value=env.PROVIDER_OAUTH_STATE_SECRET;
  if(!value||value.length<32) throw new Error('provider_oauth_state_secret_not_configured');
  return value;
}

export function issueProviderState(input:Omit<ProviderOAuthState,'issuedAt'>,env:NodeJS.ProcessEnv=process.env){
  const body=encode(JSON.stringify({...input,issuedAt:Date.now()}));
  const mac=createHmac('sha256',stateSecret(env)).update(body).digest('base64url');
  return body+'.'+mac;
}

export function verifyProviderState(value:string,maxAgeMs=600000,env:NodeJS.ProcessEnv=process.env):ProviderOAuthState{
  const parts=value.split('.');
  if(parts.length!==2) throw new Error('invalid_provider_oauth_state');
  const [body,mac]=parts;
  if(!body||!mac||!/^[A-Za-z0-9_-]+$/.test(body)||!/^[A-Za-z0-9_-]+$/.test(mac)){
    throw new Error('invalid_provider_oauth_state');
  }
  const actual=Buffer.from(mac,'base64url');
  if(actual.toString('base64url')!==mac) throw new Error('invalid_provider_oauth_state');
  const expected=createHmac('sha256',stateSecret(env)).update(body).digest();
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected)) throw new Error('invalid_provider_oauth_state');
  let parsed:unknown;
  try{parsed=JSON.parse(decode(body));}catch{throw new Error('invalid_provider_oauth_state');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) throw new Error('invalid_provider_oauth_state');
  const candidate=parsed as Partial<ProviderOAuthState>;
  if(
    !['walmart','ebay','etsy','shopify'].includes(String(candidate.provider))||
    typeof candidate.companyId!=='string'||!candidate.companyId||
    typeof candidate.redirectUri!=='string'||!candidate.redirectUri||
    typeof candidate.issuedAt!=='number'||!Number.isFinite(candidate.issuedAt)
  ) throw new Error('invalid_provider_oauth_state');
  if(candidate.provider==='shopify'){
    if(typeof candidate.shopDomain!=='string'||!canonicalShopifyShopDomain(candidate.shopDomain)){
      throw new Error('invalid_provider_oauth_state');
    }
    candidate.shopDomain=canonicalShopifyShopDomain(candidate.shopDomain);
  }
  const age=Date.now()-candidate.issuedAt;
  if(age<0||age>maxAgeMs) throw new Error(age<0?'invalid_provider_oauth_state':'expired_provider_oauth_state');
  return candidate as ProviderOAuthState;
}

export function canonicalShopifyShopDomain(value:string):string|undefined{
  const normalized=value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)?normalized:undefined;
}

export function verifyShopifyOAuthCallback(url:URL,expectedShopDomain:string,env:NodeJS.ProcessEnv=process.env){
  const secret=env.SHOPIFY_CLIENT_SECRET;
  if(!secret) throw new Error('shopify_oauth_not_configured');
  const hmac=url.searchParams.get('hmac');
  const shop=url.searchParams.get('shop');
  if(!hmac||!/^[a-f0-9]{64}$/i.test(hmac)) throw new Error('shopify_oauth_hmac_invalid');
  const canonicalShop=shop?canonicalShopifyShopDomain(shop):null;
  if(!canonicalShop||canonicalShop!==canonicalShopifyShopDomain(expectedShopDomain)){
    throw new Error('shopify_oauth_shop_mismatch');
  }
  const entries=[...url.searchParams.entries()]
    .filter(([key])=>key!=='hmac')
    .sort(([a],[b])=>a.localeCompare(b));
  const message=entries.map(([key,value])=>`${key}=${value}`).join('&');
  const expected=createHmac('sha256',secret).update(message).digest();
  const actual=Buffer.from(hmac,'hex');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){
    throw new Error('shopify_oauth_hmac_invalid');
  }
  return canonicalShop;
}

export function createPkcePair(){
  const verifier=randomBytes(32).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  return {verifier,challenge};
}

export function buildProviderAuthorization(args:{
  provider:OAuthProvider;
  companyId:string;
  redirectUri:string;
  walmartCallbackUri?:string;
  pkceChallenge?:string;
  shopDomain?:string;
  env?:NodeJS.ProcessEnv;
}){
  const env=args.env??process.env;
  const shopDomain=args.provider==='shopify'&&args.shopDomain
    ? canonicalShopifyShopDomain(args.shopDomain)
    : undefined;
  if(args.provider==='shopify'&&!shopDomain) throw new Error('shopify_shop_domain_invalid');
  const state=issueProviderState({
    provider:args.provider,
    companyId:args.companyId,
    redirectUri:args.redirectUri,
    shopDomain
  },env);

  if(args.provider==='walmart'){
    const clientId=env.WALMART_CLIENT_ID;
    if(!clientId) throw new Error('walmart_oauth_not_configured');
    const endpoint=args.walmartCallbackUri||env.WALMART_AUTHORIZATION_URL||'https://login.account.wal-mart.com/authorize';
    const url=new URL(endpoint);
    url.searchParams.set('responseType','code');
    url.searchParams.set('clientId',clientId);
    url.searchParams.set('redirectUri',args.redirectUri);
    url.searchParams.set('clientType',env.WALMART_CLIENT_TYPE||'seller');
    url.searchParams.set('nonce',randomBytes(16).toString('hex'));
    url.searchParams.set('state',state);
    return {provider:'walmart' as const,authorizationUrl:url.toString(),state};
  }

  if(args.provider==='shopify'){
    const clientId=env.SHOPIFY_CLIENT_ID;
    const scopes=env.SHOPIFY_OAUTH_SCOPES;
    if(!clientId||!scopes||!shopDomain) throw new Error('shopify_oauth_not_configured');
    const url=new URL(`https://${shopDomain}/admin/oauth/authorize`);
    url.searchParams.set('client_id',clientId);
    url.searchParams.set('scope',scopes);
    url.searchParams.set('redirect_uri',args.redirectUri);
    url.searchParams.set('state',state);
    return {provider:'shopify' as const,authorizationUrl:url.toString(),state};
  }

  if(args.provider==='etsy'){
    const clientId=env.ETSY_CLIENT_ID;
    const scopes=env.ETSY_OAUTH_SCOPES;
    if(!clientId||!scopes||!args.pkceChallenge) throw new Error('etsy_oauth_not_configured');
    const url=new URL(env.ETSY_AUTHORIZATION_URL||'https://www.etsy.com/oauth/connect');
    url.searchParams.set('response_type','code');
    url.searchParams.set('client_id',clientId);
    url.searchParams.set('redirect_uri',args.redirectUri);
    url.searchParams.set('scope',scopes);
    url.searchParams.set('state',state);
    url.searchParams.set('code_challenge',args.pkceChallenge);
    url.searchParams.set('code_challenge_method','S256');
    return {provider:'etsy' as const,authorizationUrl:url.toString(),state};
  }

  const clientId=env.EBAY_CLIENT_ID;
  const scopes=env.EBAY_OAUTH_SCOPES;
  if(!clientId||!scopes) throw new Error('ebay_oauth_not_configured');
  const url=new URL(env.EBAY_AUTHORIZATION_URL||'https://auth.ebay.com/oauth2/authorize');
  url.searchParams.set('client_id',clientId);
  url.searchParams.set('response_type','code');
  url.searchParams.set('redirect_uri',args.redirectUri);
  url.searchParams.set('scope',scopes);
  url.searchParams.set('state',state);
  return {provider:'ebay' as const,authorizationUrl:url.toString(),state};
}
