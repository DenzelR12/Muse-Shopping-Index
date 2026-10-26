import type {Pool} from 'pg';

const schema="CREATE TABLE IF NOT EXISTS api_rate_limit_buckets (bucket_key TEXT NOT NULL, window_start TIMESTAMPTZ NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(bucket_key,window_start)); CREATE INDEX IF NOT EXISTS idx_api_rate_limit_expiry ON api_rate_limit_buckets(window_start);";

export interface SharedRateLimitResult {
  allowed:boolean;
  remaining:number;
  resetAt:string;
}

export class PostgresRateLimiter {
  private initialized=false;
  constructor(private readonly pool:Pool,private readonly limit:number,private readonly windowSeconds:number){
    if(!Number.isInteger(limit)||limit<1) throw new Error('invalid_rate_limit');
    if(!Number.isInteger(windowSeconds)||windowSeconds<1) throw new Error('invalid_rate_window');
  }
  private async init(){
    if(this.initialized) return;
    await this.pool.query(schema);
    this.initialized=true;
  }
  async check(bucketKey:string,now=new Date()):Promise<SharedRateLimitResult>{
    await this.init();
    const epoch=Math.floor(now.getTime()/1000);
    const windowStartEpoch=epoch-(epoch%this.windowSeconds);
    const windowStart=new Date(windowStartEpoch*1000).toISOString();
    const resetAt=new Date((windowStartEpoch+this.windowSeconds)*1000).toISOString();
    const result=await this.pool.query(
      'INSERT INTO api_rate_limit_buckets (bucket_key,window_start,count) VALUES ($1,$2,1) ON CONFLICT (bucket_key,window_start) DO UPDATE SET count=api_rate_limit_buckets.count+1 RETURNING count',
      [bucketKey,windowStart]
    );
    const count=Number(result.rows[0]?.count??this.limit+1);
    return {allowed:count<=this.limit,remaining:Math.max(0,this.limit-count),resetAt};
  }
  async purge(now=new Date()){
    await this.init();
    const cutoff=new Date(now.getTime()-this.windowSeconds*2000).toISOString();
    await this.pool.query('DELETE FROM api_rate_limit_buckets WHERE window_start < $1',[cutoff]);
  }
}
