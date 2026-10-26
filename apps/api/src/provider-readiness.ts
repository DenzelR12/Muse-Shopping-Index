import {
  buildBusinessCapabilityManifest,
  type BusinessCapabilityManifest,
  type BusinessOrigin,
  type BusinessReadinessEvidence,
  type ConnectorVertical,
  type IntegrationMode,
  type MetaBusinessVerification,
  type ProviderCapability,
  type ProviderConnectionStatus
} from '@gift-signal/mcp-gateway';

export interface ProviderVerificationEvidence {
  connection:ProviderConnectionStatus & {companyId:string};
  identityVerified:boolean;
  // Business origin for the Meta verification gate. Omitted origin fails
  // closed to the Meta-origin path in deriveBusinessReadiness, so a
  // Meta-origin business evaluated without metaVerification can never
  // reach TRANSACTION_READY here. metaVerification must be supplied and
  // recorded server-side; it is not read from model output or browser JSON.
  // Note: the Postgres readiness store does not yet persist
  // metaVerification (it stores only the legacy metaBusinessVerified flag),
  // so callers must supply it at evaluation time until that store gains a
  // column for it. That gap fails closed rather than bypassing the gate.
  origin?:BusinessOrigin;
  metaBusinessVerified?:boolean;
  metaVerification?:MetaBusinessVerification;
  catalogValidated:boolean;
  webhookEvents:boolean;
  idempotency:boolean;
  providerRevalidation:boolean;
  agentPolicyConfigured:boolean;
  auditTrail:boolean;
  recoveryActions:boolean;
  fulfillmentStatus:boolean;
}

function hasCapability(granted:ProviderCapability[],capability:ProviderCapability){
  return granted.includes(capability);
}

export function deriveProviderReadinessEvidence(input:ProviderVerificationEvidence):BusinessReadinessEvidence{
  const healthBlocked=['REAUTH_REQUIRED','ERROR','REVOKED'];
  const health=(input.connection as any).health as string|undefined;
  const connectionUsable=!health||!healthBlocked.includes(health);
  const granted=input.connection.grantedCapabilities;

  return {
    origin:input.origin,
    connectorConfigured:connectionUsable,
    identityVerified:input.identityVerified,
    metaBusinessVerified:input.metaBusinessVerified===true,
    ...(input.metaVerification?{metaVerification:input.metaVerification}:{}),
    catalogValidated:input.catalogValidated && hasCapability(granted,'catalog.read'),
    liveInventory:connectionUsable && hasCapability(granted,'inventory.read'),
    livePricing:connectionUsable && hasCapability(granted,'pricing.read'),
    transactionAction:connectionUsable && hasCapability(granted,'order.create'),
    webhookEvents:input.webhookEvents,
    idempotency:input.idempotency,
    providerRevalidation:input.providerRevalidation,
    agentPolicyConfigured:input.agentPolicyConfigured,
    auditTrail:input.auditTrail,
    recoveryActions:input.recoveryActions,
    fulfillmentStatus:input.fulfillmentStatus && hasCapability(granted,'fulfillment.read')
  };
}

export function buildProviderReadinessManifest(args:{
  companyId:string;
  vertical:ConnectorVertical;
  integrationMode:IntegrationMode;
  verification:ProviderVerificationEvidence;
  allowedAgents?:string[];
  maxOrderAmount?:number;
  currency?:string;
}):BusinessCapabilityManifest{
  if(args.verification.connection.companyId!==args.companyId){
    throw new Error('provider_readiness_company_mismatch');
  }
  const evidence=deriveProviderReadinessEvidence(args.verification);
  const granted=args.verification.connection.grantedCapabilities;
  return buildBusinessCapabilityManifest({
    companyId:args.companyId,
    vertical:args.vertical,
    integrationMode:args.integrationMode,
    evidence,
    capabilities:{
      purchase:hasCapability(granted,'order.create'),
      cancel:hasCapability(granted,'order.cancel'),
      refund:hasCapability(granted,'refund.create'),
      trackOrder:hasCapability(granted,'fulfillment.read')
    },
    allowedAgents:args.allowedAgents,
    maxOrderAmount:args.maxOrderAmount,
    currency:args.currency
  });
}
