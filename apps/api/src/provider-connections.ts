import type {Pool} from 'pg';
import {
  providerConnectionSummary,
  type ProviderConnectionStatus,
  type ProviderCapability
} from '@gift-signal/mcp-gateway';

export interface StoredProviderConnection extends ProviderConnectionStatus {
  companyId:string;
  createdAt:string;
  updatedAt:string;
}

export class PostgresProviderConnectionStore {
  private initialized=false;
  constructor(private readonly pool:Pool){}

  private async init(){
    if(this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS provider_connections (
        company_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_account_id TEXT NOT NULL,
        granted_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
        token_expires_at TIMESTAMPTZ,
        last_sync_at TIMESTAMPTZ,
        last_sync_error TEXT,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY(company_id, provider, external_account_id)
      )
    `);
    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS provider_connections_global_owner_uq
      ON provider_connections(provider, external_account_id)
    `);
    this.initialized=true;
  }

  async upsert(input:{
    companyId:string;
    provider:string;
    externalAccountId:string;
    grantedCapabilities:ProviderCapability[];
    tokenExpiresAt?:string;
  }){
    await this.init();
    const externalAccountId=input.provider==='shopify'
      ? input.externalAccountId.trim().toLowerCase()
      : input.externalAccountId;
    if(!externalAccountId) throw new Error('provider_external_account_id_invalid');
    const owner=await this.pool.query(
      `SELECT company_id FROM provider_connections WHERE provider=$1 AND external_account_id=$2 LIMIT 1`,
      [input.provider,externalAccountId]
    );
    if(owner.rows[0]&&String(owner.rows[0].company_id)!==input.companyId){
      throw new Error('provider_account_already_claimed');
    }
    if(input.provider==='shopify'){
      const matches=await this.pool.query(
        `SELECT external_account_id
         FROM provider_connections
         WHERE company_id=$1 AND provider='shopify' AND lower(external_account_id)=lower($2)
         LIMIT 2`,
        [input.companyId,externalAccountId]
      );
      if(matches.rows.length>1) throw new Error('provider_connection_identity_ambiguous');
      if(matches.rows.length===1&&String(matches.rows[0].external_account_id)!==externalAccountId){
        throw new Error('provider_connection_identity_noncanonical');
      }
    }
    try{
      await this.pool.query(
      `INSERT INTO provider_connections
       (company_id,provider,external_account_id,granted_capabilities,token_expires_at,updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,now())
       ON CONFLICT(company_id,provider,external_account_id) DO UPDATE SET
       granted_capabilities=EXCLUDED.granted_capabilities,
       token_expires_at=EXCLUDED.token_expires_at,
       revoked_at=NULL,
       updated_at=now()`,
      [
        input.companyId,
        input.provider,
        externalAccountId,
        JSON.stringify(input.grantedCapabilities),
        input.tokenExpiresAt??null
      ]
      );
    }catch(error){
      if((error as {code?:string})?.code==='23505') throw new Error('provider_account_already_claimed');
      throw error;
    }
    return this.get(input.companyId,input.provider,externalAccountId);
  }

  async get(companyId:string,provider:string,externalAccountId:string):Promise<StoredProviderConnection|null>{
    await this.init();
    const result=await this.pool.query(
      `SELECT company_id,provider,external_account_id,granted_capabilities,token_expires_at,
              last_sync_at,last_sync_error,revoked_at,created_at,updated_at
       FROM provider_connections
       WHERE company_id=$1 AND provider=$2 AND external_account_id=$3`,
      [companyId,provider,externalAccountId]
    );
    return result.rows[0]?rowToConnection(result.rows[0]):null;
  }

  async list(companyId:string):Promise<StoredProviderConnection[]>{
    await this.init();
    const result=await this.pool.query(
      `SELECT company_id,provider,external_account_id,granted_capabilities,token_expires_at,
              last_sync_at,last_sync_error,revoked_at,created_at,updated_at
       FROM provider_connections
       WHERE company_id=$1
       ORDER BY provider,external_account_id`,
      [companyId]
    );
    return result.rows.map(rowToConnection);
  }

  async reconcileAuthorization(input:{
    companyId:string;
    provider:string;
    externalAccountId:string;
    tokenExpiresAt:string;
    grantedCapabilities?:ProviderCapability[];
  }){
    const existing=await this.get(input.companyId,input.provider,input.externalAccountId);
    return this.upsert({
      ...input,
      grantedCapabilities:input.grantedCapabilities??existing?.grantedCapabilities??[]
    });
  }

  async updateTokenExpiry(companyId:string,provider:string,externalAccountId:string,tokenExpiresAt:string){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_connections
       SET token_expires_at=$4,revoked_at=NULL,updated_at=now()
       WHERE company_id=$1 AND provider=$2 AND external_account_id=$3
       RETURNING company_id,provider,external_account_id,granted_capabilities,token_expires_at,
                 last_sync_at,last_sync_error,revoked_at,created_at,updated_at`,
      [companyId,provider,externalAccountId,tokenExpiresAt]
    );
    return result.rows[0]?rowToConnection(result.rows[0]):null;
  }

  async markSyncSuccess(companyId:string,provider:string,externalAccountId:string,when=new Date().toISOString()){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_connections
       SET last_sync_at=$4,last_sync_error=NULL,updated_at=now()
       WHERE company_id=$1 AND provider=$2 AND external_account_id=$3
       RETURNING company_id,provider,external_account_id,granted_capabilities,token_expires_at,
                 last_sync_at,last_sync_error,revoked_at,created_at,updated_at`,
      [companyId,provider,externalAccountId,when]
    );
    return result.rows[0]?rowToConnection(result.rows[0]):null;
  }

  async markSyncError(companyId:string,provider:string,externalAccountId:string,error:string){
    await this.init();
    const safeError=error.slice(0,500);
    const result=await this.pool.query(
      `UPDATE provider_connections
       SET last_sync_error=$4,updated_at=now()
       WHERE company_id=$1 AND provider=$2 AND external_account_id=$3
       RETURNING company_id,provider,external_account_id,granted_capabilities,token_expires_at,
                 last_sync_at,last_sync_error,revoked_at,created_at,updated_at`,
      [companyId,provider,externalAccountId,safeError]
    );
    return result.rows[0]?rowToConnection(result.rows[0]):null;
  }

  async revoke(companyId:string,provider:string,externalAccountId:string){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_connections
       SET revoked_at=now(),updated_at=now()
       WHERE company_id=$1 AND provider=$2 AND external_account_id=$3
       RETURNING company_id,provider,external_account_id,granted_capabilities,token_expires_at,
                 last_sync_at,last_sync_error,revoked_at,created_at,updated_at`,
      [companyId,provider,externalAccountId]
    );
    return result.rows[0]?rowToConnection(result.rows[0]):null;
  }

  async summaries(companyId:string){
    const rows=await this.list(companyId);
    return rows.map(row=>({
      ...providerConnectionSummary(row),
      companyId:row.companyId,
      createdAt:row.createdAt,
      updatedAt:row.updatedAt
    }));
  }
}

function iso(value:unknown){
  if(!value) return undefined;
  return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
}

function rowToConnection(row:any):StoredProviderConnection{
  return {
    companyId:String(row.company_id),
    provider:String(row.provider),
    externalAccountId:String(row.external_account_id),
    grantedCapabilities:Array.isArray(row.granted_capabilities)?row.granted_capabilities:[],
    tokenExpiresAt:iso(row.token_expires_at),
    lastSyncAt:iso(row.last_sync_at),
    lastSyncError:row.last_sync_error?String(row.last_sync_error):undefined,
    revokedAt:iso(row.revoked_at),
    createdAt:iso(row.created_at)??new Date(0).toISOString(),
    updatedAt:iso(row.updated_at)??new Date(0).toISOString()
  };
}
