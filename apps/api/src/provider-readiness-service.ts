import type {PostgresProviderConnectionStore} from './provider-connections.js';
import type {PostgresProviderReadinessEvidenceStore} from './provider-readiness-store.js';
import type {PostgresProviderAgentPolicyStore} from './provider-agent-policy.js';
import type {PostgresProviderAgentRegistry} from './provider-agent-registry.js';
import type {CompanySellerManifestStore} from './muse-seller-display-store.js';
import type {BusinessOrigin,MetaBusinessVerification} from '@gift-signal/mcp-gateway';
import {buildProviderReadinessManifest} from './provider-readiness.js';

export class ProviderReadinessService {
  constructor(
    private readonly connections:PostgresProviderConnectionStore,
    private readonly evidence:PostgresProviderReadinessEvidenceStore,
    private readonly policies?:PostgresProviderAgentPolicyStore,
    private readonly agents?:PostgresProviderAgentRegistry,
    // Persisted seller-manifest store (optional). When a caller does
    // not supply origin/metaVerification at evaluation time, the
    // stored record for the company is used instead, so a Meta-origin
    // business with server-recorded evidence is no longer stuck at
    // CONNECTED merely because the caller omitted the evidence. An
    // explicitly supplied origin/metaVerification always wins over
    // the stored record, and a missing or invalid stored record
    // still fails closed exactly as before.
    private readonly manifests?:Pick<CompanySellerManifestStore,'get'>
  ){}

  async evaluate(args:{
    companyId:string;
    provider:string;
    externalAccountId:string;
    vertical?:'retail'|'travel'|'tickets'|'services'|'reservations'|'digital'|'other';
    integrationMode?:'ZERO_CODE'|'LOW_CODE'|'CUSTOM_API';
    // Meta verification gate inputs. Origin/metaVerification may be
    // supplied here (evaluation-time path, unchanged) or read from
    // the persisted seller-manifest store when omitted. A Meta-origin
    // business evaluated without any valid metaVerification — supplied
    // or stored — fails closed to CONNECTED. Non-Meta-origin callers
    // set origin:'non-meta' (or store it).
    origin?:BusinessOrigin;
    metaVerification?:MetaBusinessVerification;
  }){
    const connection=await this.connections.get(args.companyId,args.provider,args.externalAccountId);
    if(!connection) throw new Error('provider_connection_not_found');
    const evidence=await this.evidence.get(args.companyId,args.provider,args.externalAccountId);
    if(!evidence) throw new Error('provider_readiness_evidence_not_found');
    const storedManifest = await this.manifests?.get(args.companyId) ?? null;
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
        origin:args.origin ?? storedManifest?.origin ?? undefined,
        identityVerified:evidence.identityVerified,
        metaBusinessVerified:evidence.metaBusinessVerified,
        ...(args.metaVerification
          ? {metaVerification:args.metaVerification}
          : storedManifest?.metaVerification
            ? {metaVerification:storedManifest.metaVerification}
            : {}),
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
