import type {Pool} from 'pg';

export interface ProviderAgentRegistration {
  companyId:string;
  agentId:string;
  revokedAt?:string;
  createdAt:string;
  updatedAt:string;
}

export class PostgresProviderAgentRegistry {
  private initialized=false;
  constructor(private readonly pool:Pool){}

  private async init(){
    if(this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS provider_agent_registry (
        company_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY(company_id,agent_id)
      )
    `);
    this.initialized=true;
  }

  async authorize(companyId:string,agentId:string){
    await this.init();
    const result=await this.pool.query(
      `INSERT INTO provider_agent_registry (company_id,agent_id,revoked_at,updated_at)
       VALUES ($1,$2,NULL,now())
       ON CONFLICT(company_id,agent_id) DO UPDATE SET revoked_at=NULL,updated_at=now()
       RETURNING *`,
      [companyId,agentId]
    );
    return row(result.rows[0]);
  }

  async revoke(companyId:string,agentId:string){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_agent_registry
       SET revoked_at=now(),updated_at=now()
       WHERE company_id=$1 AND agent_id=$2
       RETURNING *`,
      [companyId,agentId]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async requireActive(companyId:string,agentIds:string[]){
    await this.init();
    const result=await this.pool.query(
      `SELECT agent_id
       FROM provider_agent_registry
       WHERE company_id=$1 AND agent_id=ANY($2::text[]) AND revoked_at IS NULL`,
      [companyId,agentIds]
    );
    const active=new Set(result.rows.map(value=>String(value.agent_id)));
    return agentIds.filter(agentId=>!active.has(agentId));
  }
}

function row(value:any):ProviderAgentRegistration{
  return {
    companyId:String(value.company_id),
    agentId:String(value.agent_id),
    revokedAt:value.revoked_at?new Date(value.revoked_at).toISOString():undefined,
    createdAt:new Date(value.created_at).toISOString(),
    updatedAt:new Date(value.updated_at).toISOString()
  };
}
