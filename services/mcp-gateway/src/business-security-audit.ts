import {Pool} from 'pg';
import {appendAuditRecord,audit,type AuditEvent,type AuditRecord} from '@gift-signal/audit';

const schema=[
  "CREATE TABLE IF NOT EXISTS security_audit_streams (stream_id TEXT PRIMARY KEY, next_sequence BIGINT NOT NULL DEFAULT 1, head_hash TEXT NOT NULL DEFAULT 'GENESIS');",
  "CREATE TABLE IF NOT EXISTS security_audit_records (stream_id TEXT NOT NULL, sequence BIGINT NOT NULL, event_id TEXT NOT NULL, event_type TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL, record JSONB NOT NULL, event_hash TEXT NOT NULL, PRIMARY KEY(stream_id,sequence), UNIQUE(event_id));",
  "CREATE INDEX IF NOT EXISTS idx_security_audit_records_event_type ON security_audit_records(event_type,occurred_at DESC);"
].join('\n');

export interface SecurityAuditSink {
  publish(streamId:string,type:string,payload:Record<string,unknown>,meta?:Partial<AuditEvent>):Promise<AuditRecord>;
}

export class PostgresSecurityAuditSink implements SecurityAuditSink {
  private initialized=false;
  constructor(private readonly pool:Pool,private readonly signingSecret:string){}

  static fromUrl(url:string,signingSecret:string){
    if(!url) throw new Error('database_url_required');
    if(!signingSecret) throw new Error('audit_signing_secret_required');
    return new PostgresSecurityAuditSink(new Pool({connectionString:url,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined}),signingSecret);
  }

  private async init(){
    if(this.initialized) return;
    await this.pool.query(schema);
    this.initialized=true;
  }

  async publish(streamId:string,type:string,payload:Record<string,unknown>,meta:Partial<AuditEvent>={}){
    await this.init();
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("INSERT INTO security_audit_streams (stream_id) VALUES ($1) ON CONFLICT (stream_id) DO NOTHING",[streamId]);
      const state=await client.query("SELECT next_sequence,head_hash FROM security_audit_streams WHERE stream_id=$1 FOR UPDATE",[streamId]);
      const sequence=Number(state.rows[0].next_sequence);
      const previousHash=String(state.rows[0].head_hash);
      const record=appendAuditRecord({event:audit(type,payload,meta),sequence,previousHash,signingSecret:this.signingSecret});
      await client.query(
        "INSERT INTO security_audit_records (stream_id,sequence,event_id,event_type,occurred_at,record,event_hash) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)",
        [streamId,sequence,record.id,record.type,record.at,JSON.stringify(record),record.eventHash]
      );
      await client.query("UPDATE security_audit_streams SET next_sequence=$2,head_hash=$3 WHERE stream_id=$1",[streamId,sequence+1,record.eventHash]);
      await client.query('COMMIT');
      return record;
    }catch(error){
      await client.query('ROLLBACK');
      throw error;
    }finally{
      client.release();
    }
  }

  async close(){await this.pool.end();}
}
