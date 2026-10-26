import {Pool} from 'pg';
import type {ReplayStore,SignedDraftEnvelope} from '@gift-signal/zero-trust';
import type {ConnectionAuthority,DraftAuthority} from './business-zero-trust.js';
import type {ConnectorActionDraft,CustomerConnection} from './business-connectors.js';

const schema=[
"CREATE TABLE IF NOT EXISTS connector_connections (connection_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, subject_id TEXT NOT NULL, granted_actions JSONB NOT NULL, credential_ref TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ);",
"CREATE INDEX IF NOT EXISTS idx_connector_connections_company_subject ON connector_connections(company_id,subject_id);",
"CREATE TABLE IF NOT EXISTS connector_drafts (draft_id TEXT PRIMARY KEY, envelope JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), claimed_at TIMESTAMPTZ);",
"CREATE TABLE IF NOT EXISTS replay_consumptions (replay_key TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ NOT NULL DEFAULT now());",
"CREATE INDEX IF NOT EXISTS idx_replay_consumptions_expiry ON replay_consumptions(expires_at);"
].join('\n');

export class PostgresZeroTrustAuthority implements ConnectionAuthority,DraftAuthority,ReplayStore {
  private initialized=false;
  constructor(private readonly pool:Pool){}

  static fromUrl(url:string){
    if(!url) throw new Error('database_url_required');
    return new PostgresZeroTrustAuthority(new Pool({connectionString:url,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined}));
  }

  private async init(){
    if(this.initialized) return;
    await this.pool.query(schema);
    this.initialized=true;
  }

  async resolve(connectionId:string):Promise<CustomerConnection|null>{
    await this.init();
    const result=await this.pool.query(
      'SELECT connection_id,company_id,subject_id,granted_actions,credential_ref,created_at,expires_at,revoked_at FROM connector_connections WHERE connection_id=$1',
      [connectionId]
    );
    const row=result.rows[0];
    if(!row) return null;
    return {
      connectionId:row.connection_id,
      companyId:row.company_id,
      subjectId:row.subject_id,
      grantedActions:Array.isArray(row.granted_actions)?row.granted_actions:[],
      secretRef:row.credential_ref,
      createdAt:new Date(row.created_at).toISOString(),
      expiresAt:row.expires_at?new Date(row.expires_at).toISOString():undefined,
      revokedAt:row.revoked_at?new Date(row.revoked_at).toISOString():undefined
    };
  }

  async save(envelope:SignedDraftEnvelope<ConnectorActionDraft>){
    await this.init();
    await this.pool.query(
      'INSERT INTO connector_drafts (draft_id,envelope) VALUES ($1,$2::jsonb) ON CONFLICT (draft_id) DO UPDATE SET envelope=EXCLUDED.envelope,claimed_at=NULL',
      [envelope.draftId,JSON.stringify(envelope)]
    );
  }

  async get(draftId:string){
    await this.init();
    const result=await this.pool.query('SELECT envelope FROM connector_drafts WHERE draft_id=$1',[draftId]);
    return (result.rows[0]?.envelope??null) as SignedDraftEnvelope<ConnectorActionDraft>|null;
  }

  async claimExecution(draftId:string){
    await this.init();
    const result=await this.pool.query(
      'UPDATE connector_drafts SET claimed_at=now() WHERE draft_id=$1 AND claimed_at IS NULL RETURNING draft_id',
      [draftId]
    );
    return result.rowCount===1;
  }

  async consumeOnce(key:string,expiresAt:string){
    await this.init();
    const exp=new Date(expiresAt);
    if(!Number.isFinite(exp.getTime())) return false;
    const result=await this.pool.query(
      'INSERT INTO replay_consumptions (replay_key,expires_at) VALUES ($1,$2) ON CONFLICT (replay_key) DO NOTHING RETURNING replay_key',
      [key,expiresAt]
    );
    return result.rowCount===1;
  }

  async purgeExpiredReplay(){
    await this.init();
    await this.pool.query('DELETE FROM replay_consumptions WHERE expires_at <= now()');
  }

  async close(){await this.pool.end();}
}
