export const HACKATHON_REQUIRED_ENV=[
  'DATABASE_URL','OIDC_ISSUER','OIDC_AUDIENCE','OIDC_JWKS_URL','SHOP_OIDC_USER_ID_CLAIM',
  'DRAFT_SIGNING_SECRET','APPROVAL_SIGNING_SECRET','AUDIT_HASH_SECRET','AUDIT_SIGNING_SECRET','LINK_AUTHORITY_SIGNING_KEY',
  'MUSE_TRANSACTION_AGENT_ID'
] as const;
export const STRIPE_SHOPIFY_ADAPTER_ENV=['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','SHOPIFY_WEBHOOK_SECRET','PROVIDER_OAUTH_STATE_SECRET','PROVIDER_OAUTH_CALLBACK_URL','SHOPIFY_CLIENT_ID','SHOPIFY_CLIENT_SECRET','SHOPIFY_OAUTH_SCOPES'] as const;
const secureUrl=(value:string|undefined)=>{
  try{const url=new URL(value??'');return url.protocol==='https:'&&!url.username&&!url.password;}
  catch{return false;}
};
/** Presence/shape only. This does not prove identity/provider account readiness. */
export function hackathonReadiness(env:NodeJS.ProcessEnv=process.env,profile:'core'|'stripe-shopify'='core'){
  const required=profile==='stripe-shopify'?[...HACKATHON_REQUIRED_ENV,...STRIPE_SHOPIFY_ADAPTER_ENV]:HACKATHON_REQUIRED_ENV;
  const missing:string[]=required.filter(name=>!env[name]?.trim());
  if(!env.PROVIDER_TOKEN_ENCRYPTION_KEYS&&!env.PROVIDER_TOKEN_ENCRYPTION_KEY) missing.push('PROVIDER_TOKEN_ENCRYPTION_KEYS_OR_KEY');
  if(!env.META_MODEL_API_KEY?.trim()) missing.push('META_MODEL_API_KEY');
  if(!env.META_MODEL_API_BASE_URL?.trim()) missing.push('META_MODEL_API_BASE_URL');
  if(!env.META_MUSE_MODEL?.trim()) missing.push('META_MUSE_MODEL');
  const checks={
    modelKeyPresent:Boolean(env.META_MODEL_API_KEY?.trim()),
    modelBaseUrlSecure:secureUrl(env.META_MODEL_API_BASE_URL),
    modelSelected:Boolean(env.META_MUSE_MODEL?.trim()),
    identityUrlsSecure:secureUrl(env.OIDC_ISSUER)&&secureUrl(env.OIDC_JWKS_URL),
    oauthCallbackSecure:secureUrl(env.PROVIDER_OAUTH_CALLBACK_URL),
    merchantCredentialsDeclared:env.MERCHANT_PROVIDER_CREDENTIALS_CONFIGURED==='true',
    stripeTestKey:/^(sk|rk)_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY??''),
    shopifyTestStoreAttested:env.SHOPIFY_TEST_STORE_CONFIRMED==='true'&&/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(env.SHOPIFY_TEST_SHOP_DOMAIN??'')
  };
  const modelReady=checks.modelKeyPresent&&checks.modelBaseUrlSecure&&checks.modelSelected;
  const coreConfigured=modelReady&&HACKATHON_REQUIRED_ENV.every(name=>Boolean(env[name]?.trim()))&&Boolean(env.PROVIDER_TOKEN_ENCRYPTION_KEYS||env.PROVIDER_TOKEN_ENCRYPTION_KEY)&&checks.identityUrlsSecure;
  return {profile,coreConfigured,modelReady,sandboxReady:profile==='stripe-shopify'&&coreConfigured&&missing.length===0&&checks.oauthCallbackSecure&&checks.merchantCredentialsDeclared&&checks.stripeTestKey&&checks.shopifyTestStoreAttested,
    agentEnabled:env.MUSE_AGENT_ENABLED==='true',checks,missing,
    accountVerification:'NOT_PERFORMED',paymentsExecuted:0};
}
