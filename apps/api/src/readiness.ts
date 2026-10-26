export interface ProductionReadiness {
  ready:boolean;
  mode:'production'|'non-production';
  gates:{
    database:boolean;
    oidcIdentity:boolean;
    shopConsumerIdentity:boolean;
    muse:boolean;
    museTransactionAgent:boolean;
    stripe:boolean;
    zeroTrustSigning:boolean;
    providerAuditSigning:boolean;
    providerTokenEncryption:boolean;
    shopifyOAuth:boolean;
    shopifyWebhook:boolean;
    merchantProvider:boolean;
  };
  missing:string[];
}

export function productionReadiness(env:NodeJS.ProcessEnv=process.env):ProductionReadiness{
  const gates={
    database:Boolean(env.DATABASE_URL),
    oidcIdentity:Boolean(env.OIDC_ISSUER&&env.OIDC_AUDIENCE&&env.OIDC_JWKS_URL),
    shopConsumerIdentity:Boolean(env.SHOP_OIDC_USER_ID_CLAIM?.trim()),
    muse:Boolean(env.META_MODEL_API_KEY&&env.META_MODEL_API_BASE_URL&&env.META_MUSE_MODEL),
    museTransactionAgent:Boolean(env.MUSE_TRANSACTION_AGENT_ID),
    stripe:Boolean(env.STRIPE_SECRET_KEY&&env.STRIPE_WEBHOOK_SECRET),
    zeroTrustSigning:Boolean(env.DRAFT_SIGNING_SECRET&&env.APPROVAL_SIGNING_SECRET&&env.AUDIT_HASH_SECRET&&env.LINK_AUTHORITY_SIGNING_KEY),
    providerAuditSigning:Boolean(env.AUDIT_SIGNING_SECRET),
    providerTokenEncryption:Boolean(env.PROVIDER_TOKEN_ENCRYPTION_KEYS||env.PROVIDER_TOKEN_ENCRYPTION_KEY),
    shopifyOAuth:Boolean(
      env.PROVIDER_OAUTH_STATE_SECRET&&
      env.PROVIDER_OAUTH_CALLBACK_URL&&
      env.SHOPIFY_CLIENT_ID&&
      env.SHOPIFY_CLIENT_SECRET&&
      env.SHOPIFY_OAUTH_SCOPES
    ),
    shopifyWebhook:Boolean(env.SHOPIFY_WEBHOOK_SECRET),
    merchantProvider:Boolean(env.MERCHANT_PROVIDER_CREDENTIALS_CONFIGURED==='true'||env.NODE_ENV!=='production'&&env.MERCHANT_PROVIDER_MODE==='demo')
  };
  const missing=Object.entries(gates).filter(([,ok])=>!ok).map(([name])=>name);
  const mode=env.NODE_ENV==='production'?'production':'non-production';
  return {ready:mode==='production'&&missing.length===0,mode,gates,missing};
}

