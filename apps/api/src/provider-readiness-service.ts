import type {PostgresProviderConnectionStore} from './provider-connections.js';
import type {PostgresProviderReadinessEvidenceStore} from './provider-readiness-store.js';
import type {PostgresProviderAgentPolicyStore} from './provider-agent-policy.js';
import type {PostgresProviderAgentRegistry} from './provider-agent-registry.js';
import {buildProviderReadinessManifest} from './provider-readiness.js';

export class ProviderReadinessService {
  constructor(
    private readonly connections:PostgresProviderConnectionStore,
    private readonly evidence:PostgresProviderReadinessEvidenceStore,
    private readonly policies?:PostgresProviderAgentPolicyStore,
    private readonly agents?:PostgresProviderAgentRegistry
  ){}

  async evaluate(args:{
    companyId:string;
    provider:string;
    externalAccountId:string;
    vertical?:'retail'|'travel'|'tickets'|'services'|'reservations'|'digital'|'other';
    integrationMode?:'ZERO_CODE'|'LOW_CODE'|'CUSTOM_API';
  }){
    const connection=await this.connections.get(args.companyId,args.provider,args.externalAccountId);
    if(!connection) throw new Error('provider_connection_not_found');
    const evidence=await this.evidence.get(args.companyId,args.provider,args.externalAccountId);
    if(!evidence) throw new Error('provider_readiness_evidence_not_found');
    const policy=await this.policies?.get(args.companyId,args.provider,args.externalAccountId)??null;
    const unauthorizedAgents=policy&&this.agents
      ? await this.agents.requireActive(args.companyId,policy.allowedAgents)
      : policy?.allowedAgents??[];
    const policyActive=Boolean(policy)&&unauthorizedAgents.length===0;
    return buildProviderReadinessManifest({
      companyId:args.companyId,
      vertical:args.vertical??'retail',
      integrationMode:args.integrationMode??'ZERO_CODE',
      verification:{
        connection,
        identityVerified:evidence.identityVerified,
        metaBusinessVerified:evidence.metaBusinessVerified,
        catalogValidated:evidence.catalogValidated,
        webhookEvents:evidence.webhookEvents,
        idempotency:evidence.idempotency,
        providerRevalidation:evidence.providerRevalidation,
        agentPolicyConfigured:policyActive,
        auditTrail:evidence.auditTrail,
        recoveryActions:evidence.recoveryActions,
        fulfillmentStatus:evidence.fulfillmentStatus
      },
      allowedAgents:policyActive?policy?.allowedAgents:undefined,
      maxOrderAmount:policyActive?policy?.maxOrderAmount:undefined,
      currency:policyActive?policy?.currency:undefined
    });
  }
}
