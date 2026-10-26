import type {ProviderTokenSet} from './provider-token-exchange.js';

export interface ProviderRevocationResult {
  upstream:'revoked'|'unsupported';
}

export async function revokeProviderAuthorization(args:{
  token:ProviderTokenSet;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}):Promise<ProviderRevocationResult>{
  if(args.token.provider!=='ebay') return {upstream:'unsupported'};

  const env=args.env??process.env;
  const clientId=env.EBAY_CLIENT_ID;
  const clientSecret=env.EBAY_CLIENT_SECRET;
  if(!clientId||!clientSecret) throw new Error('ebay_oauth_not_configured');

  const revokeToken=args.token.refreshToken??args.token.accessToken;
  const tokenType=args.token.refreshToken?'refresh_token':'access_token';
  if(!revokeToken) throw new Error('ebay_revoke_token_missing');

  const request=args.fetchImpl??fetch;
  const response=await request(
    env.EBAY_REVOKE_URL||'https://api.ebay.com/identity/v1/oauth2/token/revoke',
    {
      method:'POST',
      headers:{
        authorization:'Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64'),
        'content-type':'application/x-www-form-urlencoded'
      },
      body:new URLSearchParams({token:revokeToken,token_type_hint:tokenType})
    }
  );
  if(!response.ok) throw new Error('provider_upstream_revoke_failed');
  return {upstream:'revoked'};
}
