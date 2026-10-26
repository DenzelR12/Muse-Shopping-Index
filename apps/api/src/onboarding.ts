export interface ConnectionGate {
  key:string;
  label:string;
  configured:boolean;
  requiredForProduction:boolean;
}

// Meta business verification is required for Meta-origin businesses only,
// and only as server-recorded evidence (see MetaBusinessVerification in
// business-connectors.ts). It is not a live Meta API verification claim,
// and it is never required for non-Meta-origin businesses. The old blanket
// `metaBusinessRequired:false` was therefore wrong for Meta-origin
// businesses and is replaced by the origin-conditional pair below; a
// business whose origin is not explicitly declared 'non-meta' fails closed
// to the Meta-origin path.
export const businessParticipationModel={
  metaBusinessRequiredForMetaOrigin:true,
  metaBusinessRequiredForNonMetaOrigin:false,
  supportedIntegrationModes:[
    {
      mode:'ZERO_CODE',
      description:'Use a supported connector and authorize the required scopes. No custom business-side development is required.'
    },
    {
      mode:'LOW_CODE',
      description:'Map existing API, feed, webhook, catalog, order, booking, or fulfillment fields into the Gift Signal contract.'
    },
    {
      mode:'CUSTOM_API',
      description:'Build a thin adapter only when the business has a proprietary system without a supported API, feed, webhook, or connector.'
    }
  ],
  readinessStages:[
    'CONNECTED',
    'META_VERIFIED',
    'CATALOG_VERIFIED',
    'TRANSACTION_READY',
    'AUTONOMOUS_READY'
  ],
  readinessStagesNonMetaOrigin:[
    'CONNECTED',
    'VERIFIED',
    'TRANSACTION_READY',
    'AUTONOMOUS_READY'
  ],
  providerNeutral:true,
  metaIsOptionalDistributionSurface:true
} as const;

export function onboardingStatus(env:NodeJS.ProcessEnv=process.env){
  const gates:ConnectionGate[]=[
    {key:'database',label:'Durable Postgres state',configured:Boolean(env.DATABASE_URL),requiredForProduction:true},
    {key:'oidc',label:'Human identity provider (OIDC/JWKS)',configured:Boolean(env.OIDC_ISSUER&&env.OIDC_AUDIENCE&&env.OIDC_JWKS_URL),requiredForProduction:true},
    {key:'muse',label:'Meta Model API / Muse',configured:Boolean(env.META_MODEL_API_KEY&&env.META_MODEL_API_BASE_URL&&env.META_MUSE_MODEL),requiredForProduction:true},
    {key:'stripe',label:'Stripe payments + webhook',configured:Boolean(env.STRIPE_SECRET_KEY&&env.STRIPE_WEBHOOK_SECRET),requiredForProduction:true},
    {key:'merchant',label:'Authorized merchant/provider credentials',configured:Boolean(env.MERCHANT_PROVIDER_MODE==='demo'||env.MERCHANT_PROVIDER_CREDENTIALS_CONFIGURED==='true'),requiredForProduction:true},
    {key:'shopify',label:'Shopify webhook connection',configured:Boolean(env.SHOPIFY_SHOP_DOMAIN&&env.SHOPIFY_WEBHOOK_SECRET),requiredForProduction:false}
  ];
  return {
    ready:gates.filter(g=>g.requiredForProduction).every(g=>g.configured),
    gates,
    next:gates.filter(g=>g.requiredForProduction&&!g.configured).map(g=>g.key),
    businessParticipation:businessParticipationModel
  };
}
