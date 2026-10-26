import type {Pool} from 'pg';

export interface ProviderEvidenceRecord {
  companyId:string;
  provider:string;
  externalAccountId:string;
  identityVerified:boolean;
  metaBusinessVerified:boolean;
  catalogValidated:boolean;
  webhookEvents:boolean;
  idempotency:boolean;
  providerRevalidation:boolean;
  agentPolicyConfigured:boolean;
  auditTrail:boolean;
  recoveryActions:boolean;
  fulfillmentStatus:boolean;
  updatedAt:string;
}

export class PostgresProviderReadinessEvidenceStore {
  private initialized=false;
  constructor(private readonly pool:Pool){}

  private async init(){
    if(this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS provider_readiness_evidence (
        company_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_account_id TEXT NOT NULL,
        identity_verified BOOLEAN NOT NULL DEFAULT false,
        meta_business_verified BOOLEAN NOT NULL DEFAULT false,
        catalog_validated BOOLEAN NOT NULL DEFAULT false,
        webhook_events BOOLEAN NOT NULL DEFAULT false,
        idempotency BOOLEAN NOT NULL DEFAULT false,
        provider_revalidation BOOLEAN NOT NULL DEFAULT false,
        agent_policy_configured BOOLEAN NOT NULL DEFAULT false,
        audit_trail BOOLEAN NOT NULL DEFAULT false,
        recovery_actions BOOLEAN NOT NULL DEFAULT false,
        fulfillment_status BOOLEAN NOT NULL DEFAULT false,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY(company_id,provider,external_account_id)
      );
      ALTER TABLE provider_readiness_evidence ADD COLUMN IF NOT EXISTS meta_business_verified BOOLEAN NOT NULL DEFAULT false
    `);
    this.initialized=true;
  }

  async upsert(input:Omit<ProviderEvidenceRecord,'updatedAt'>){
    await this.init();
    const result=await this.pool.query(
      `INSERT INTO provider_readiness_evidence
       (company_id,provider,external_account_id,identity_verified,meta_business_verified,catalog_validated,webhook_events,
        idempotency,provider_revalidation,agent_policy_configured,audit_trail,recovery_actions,
        fulfillment_status,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
       ON CONFLICT(company_id,provider,external_account_id) DO UPDATE SET
       identity_verified=EXCLUDED.identity_verified,
       meta_business_verified=EXCLUDED.meta_business_verified,
       catalog_validated=EXCLUDED.catalog_validated,
       webhook_events=EXCLUDED.webhook_events,
       idempotency=EXCLUDED.idempotency,
       provider_revalidation=EXCLUDED.provider_revalidation,
       agent_policy_configured=EXCLUDED.agent_policy_configured,
       audit_trail=EXCLUDED.audit_trail,
       recovery_actions=EXCLUDED.recovery_actions,
       fulfillment_status=EXCLUDED.fulfillment_status,
       updated_at=now()
       RETURNING *`,
      [
        input.companyId,input.provider,input.externalAccountId,input.identityVerified,input.metaBusinessVerified,input.catalogValidated,
        input.webhookEvents,input.idempotency,input.providerRevalidation,input.agentPolicyConfigured,
        input.auditTrail,input.recoveryActions,input.fulfillmentStatus
      ]
    );
    return rowToEvidence(result.rows[0]);
  }

  async resetAuthorizationEpoch(
    key:{companyId:string;provider:string;externalAccountId:string},
    trusted:{identityVerified:boolean;auditTrail:boolean}
  ){
    return this.upsert({
      ...key,
      identityVerified:trusted.identityVerified,
      metaBusinessVerified:false,
      catalogValidated:false,
      webhookEvents:false,
      idempotency:false,
      providerRevalidation:false,
      agentPolicyConfigured:false,
      auditTrail:trusted.auditTrail,
      recoveryActions:false,
      fulfillmentStatus:false
    });
  }

  async clearForRevocation(key:{companyId:string;provider:string;externalAccountId:string}){
    return this.upsert({
      ...key,
      identityVerified:false,
      metaBusinessVerified:false,
      catalogValidated:false,
      webhookEvents:false,
      idempotency:false,
      providerRevalidation:false,
      agentPolicyConfigured:false,
      auditTrail:false,
      recoveryActions:false,
      fulfillmentStatus:false
    });
  }

  async markTrusted(
    key:{companyId:string;provider:string;externalAccountId:string},
    patch:Partial<Pick<ProviderEvidenceRecord,'identityVerified'|'metaBusinessVerified'|'catalogValidated'|'webhookEvents'|'idempotency'|'providerRevalidation'|'auditTrail'|'recoveryActions'|'fulfillmentStatus'>>
  ){
    await this.init();
    const result=await this.pool.query(
      `INSERT INTO provider_readiness_evidence
       (company_id,provider,external_account_id,identity_verified,meta_business_verified,catalog_validated,webhook_events,idempotency,provider_revalidation,audit_trail,recovery_actions,fulfillment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(company_id,provider,external_account_id) DO UPDATE SET
       identity_verified=provider_readiness_evidence.identity_verified OR EXCLUDED.identity_verified,
       meta_business_verified=provider_readiness_evidence.meta_business_verified OR EXCLUDED.meta_business_verified,
       catalog_validated=provider_readiness_evidence.catalog_validated OR EXCLUDED.catalog_validated,
       webhook_events=provider_readiness_evidence.webhook_events OR EXCLUDED.webhook_events,
       idempotency=provider_readiness_evidence.idempotency OR EXCLUDED.idempotency,
       provider_revalidation=provider_readiness_evidence.provider_revalidation OR EXCLUDED.provider_revalidation,
       audit_trail=provider_readiness_evidence.audit_trail OR EXCLUDED.audit_trail,
       recovery_actions=provider_readiness_evidence.recovery_actions OR EXCLUDED.recovery_actions,
       fulfillment_status=provider_readiness_evidence.fulfillment_status OR EXCLUDED.fulfillment_status,
       updated_at=now()
       RETURNING *`,
      [
        key.companyId,key.provider,key.externalAccountId,
        patch.identityVerified===true,
        patch.metaBusinessVerified===true,
        patch.catalogValidated===true,
        patch.webhookEvents===true,
        patch.idempotency===true,
        patch.providerRevalidation===true,
        patch.auditTrail===true,
        patch.recoveryActions===true,
        patch.fulfillmentStatus===true
      ]
    );
    return rowToEvidence(result.rows[0]);
  }

  async get(companyId:string,provider:string,externalAccountId:string){
    await this.init();
    const result=await this.pool.query(
      `SELECT * FROM provider_readiness_evidence
       WHERE company_id=$1 AND provider=$2 AND external_account_id=$3`,
      [companyId,provider,externalAccountId]
    );
    return result.rows[0]?rowToEvidence(result.rows[0]):null;
  }
}

function rowToEvidence(row:any):ProviderEvidenceRecord{
  return {
    companyId:String(row.company_id),
    provider:String(row.provider),
    externalAccountId:String(row.external_account_id),
    identityVerified:Boolean(row.identity_verified),
    metaBusinessVerified:Boolean(row.meta_business_verified),
    catalogValidated:Boolean(row.catalog_validated),
    webhookEvents:Boolean(row.webhook_events),
    idempotency:Boolean(row.idempotency),
    providerRevalidation:Boolean(row.provider_revalidation),
    agentPolicyConfigured:Boolean(row.agent_policy_configured),
    auditTrail:Boolean(row.audit_trail),
    recoveryActions:Boolean(row.recovery_actions),
    fulfillmentStatus:Boolean(row.fulfillment_status),
    updatedAt:new Date(row.updated_at).toISOString()
  };
}
