import {
  buildBusinessCapabilityManifest,
  type BusinessCapabilityManifest,
  type BusinessReadinessEvidence,
  type ConnectorVertical,
  type IntegrationMode,
  type ProviderCapability,
  type ProviderConnectionStatus
} from '@gift-signal/mcp-gateway';

export interface ProviderVerificationEvidence {
  connection:ProviderConnectionStatus & {companyId:string};
  identityVerified:boolean;
  metaBusinessVerified?:boolean;
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
    connectorConfigured:connectionUsable,
    identityVerified:input.identityVerified,
    metaBusinessVerified:input.metaBusinessVerified===true,
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
