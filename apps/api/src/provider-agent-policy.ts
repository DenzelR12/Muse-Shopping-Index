import type {Pool} from 'pg';

export interface ProviderAgentPolicyRecord {
  companyId:string;
  provider:string;
  externalAccountId:string;
  allowedAgents:string[];
  maxOrderAmount:number;
  currency:string;
  updatedAt:string;
}

export class PostgresProviderAgentPolicyStore {
  private initialized=false;
  constructor(private readonly pool:Pool){}

  private async init(){
    if(this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS provider_agent_policies (
        company_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_account_id TEXT NOT NULL,
        allowed_agents JSONB NOT NULL,
        max_order_amount NUMERIC(14,2) NOT NULL,
        currency TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY(company_id,provider,external_account_id)
      )
    `);
    this.initialized=true;
  }

  async upsert(input:{
    companyId:string;
    provider:string;
    externalAccountId:string;
    allowedAgents:string[];
    maxOrderAmount:number;
    currency:string;
  }){
    await this.init();
    const result=await this.pool.query(
      `INSERT INTO provider_agent_policies
       (company_id,provider,external_account_id,allowed_agents,max_order_amount,currency,updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,now())
       ON CONFLICT(company_id,provider,external_account_id) DO UPDATE SET
       allowed_agents=EXCLUDED.allowed_agents,
       max_order_amount=EXCLUDED.max_order_amount,
       currency=EXCLUDED.currency,
       updated_at=now()
       RETURNING *`,
      [
        input.companyId,
        input.provider,
        input.externalAccountId,
        JSON.stringify(input.allowedAgents),
        input.maxOrderAmount,
        input.currency
      ]
    );
    return rowToPolicy(result.rows[0]);
  }

  async get(companyId:string,provider:string,externalAccountId:string):Promise<ProviderAgentPolicyRecord|null>{
    await this.init();
    const result=await this.pool.query(
      `SELECT * FROM provider_agent_policies
       WHERE company_id=$1 AND provider=$2 AND external_account_id=$3`,
      [companyId,provider,externalAccountId]
    );
    return result.rows[0]?rowToPolicy(result.rows[0]):null;
  }
}

function rowToPolicy(row:any):ProviderAgentPolicyRecord{
  return {
    companyId:String(row.company_id),
    provider:String(row.provider),
    externalAccountId:String(row.external_account_id),
    allowedAgents:Array.isArray(row.allowed_agents)?row.allowed_agents.map(String):[],
    maxOrderAmount:Number(row.max_order_amount),
    currency:String(row.currency),
    updatedAt:new Date(row.updated_at).toISOString()
  };
}
