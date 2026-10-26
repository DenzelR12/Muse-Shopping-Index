import type {SecurityAuditSink} from '@gift-signal/mcp-gateway';

const forbidden=/token|secret|authorization|credential|password|codeverifier|code_verifier/i;

export type ProviderSecurityEvent=
  | 'provider.oauth.started'
  | 'provider.oauth.completed'
  | 'provider.credential.refreshed'
  | 'provider.credential.rekeyed'
  | 'provider.credential.rekey_batch'
  | 'provider.sync.succeeded'
  | 'provider.sync.failed'
  | 'provider.orders.read'
  | 'provider.readiness.updated'
  | 'provider.recovery.verified'
  | 'provider.connection.capabilities_updated'
  | 'provider.agent_policy.updated'
  | 'provider.agent_authorized'
  | 'provider.agent_revoked'
  | 'provider.connection.revoked'
  | 'provider.transaction.checkout_created'
  | 'provider.transaction.direct_payment_confirmed'
  | 'provider.order.created'
  | 'provider.draft_order.created'
  | 'provider.draft_order.completed'
  | 'provider.transaction.reconciliation_resolved'
  | 'provider.transaction.refund_submitted'
  | 'provider.transaction.refunded'
  | 'provider.transaction.refund_failed';

export interface ProviderAuditMetadata {
  companyId:string;
  provider:string;
  externalAccountId?:string;
  requestId?:string;
  syncKind?:string;
  itemCount?:number;
  readiness?:string;
  errorCode?:string;
  upstreamRevocation?:string;
  currentKeyId?:string;
  migratedCount?:number;
  remainingCount?:number;
  capabilityCount?:number;
  allowedAgentCount?:number;
  maxOrderAmount?:number;
  currency?:string;
  agentId?:string;
  amount?:number;
  draftId?:string;
  reconciliationResolution?:string;
}

export function assertSafeProviderAuditMetadata(metadata:ProviderAuditMetadata){
  for(const [key,value] of Object.entries(metadata)){
    if(forbidden.test(key)) throw new Error('provider_audit_secret_field_rejected');
    if(typeof value==='string' && /^(bearer\s+|eyJ[a-zA-Z0-9_-]*\.|v1\.[A-Za-z0-9_-]+\.)/i.test(value)){
      throw new Error('provider_audit_secret_value_rejected');
    }
  }
  return metadata;
}

export class ProviderSecurityAuditor {
  constructor(private readonly sink:SecurityAuditSink){}

  async record(type:ProviderSecurityEvent,metadata:ProviderAuditMetadata){
    const safe=assertSafeProviderAuditMetadata(metadata);
    return this.sink.publish(
      'provider:'+safe.companyId,
      type,
      {...safe} as Record<string,unknown>
    );
  }
}
