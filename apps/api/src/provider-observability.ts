import type {Pool} from 'pg';

export type ProviderHealthLevel='OK'|'WARN'|'CRITICAL';

export interface ProviderOperationalSummary {
  companyId:string;
  level:ProviderHealthLevel;
  generatedAt:string;
  reconciliation:{
    pending:number;
    oldestAgeMinutes:number|null;
  };
  compensation:{
    pendingRefunds:number;
    oldestAgeMinutes:number|null;
  };
  transactions:Record<string,number>;
  webhookFailures:{
    lastHour:number;
    last24Hours:number;
  };
  thresholds:{
    reconcileWarn:number;
    reconcileCritical:number;
    reconcileAgeWarnMinutes:number;
    reconcileAgeCriticalMinutes:number;
    webhookFailureWarn:number;
    webhookFailureCritical:number;
  };
  alerts:string[];
}

export class PostgresProviderObservabilityStore {
  private initialized=false;
  constructor(
    private readonly pool:Pool,
    private readonly env:NodeJS.ProcessEnv=process.env
  ){}

  private async init(){
    if(this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS provider_operational_events (
        id BIGSERIAL PRIMARY KEY,
        company_id TEXT,
        provider TEXT NOT NULL,
        event_type TEXT NOT NULL,
        error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_provider_operational_events_created ON provider_operational_events(created_at DESC)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_provider_operational_events_company_created ON provider_operational_events(company_id,created_at DESC)');
    this.initialized=true;
  }

  async record(input:{
    companyId?:string;
    provider:string;
    eventType:string;
    errorCode?:string;
  }){
    await this.init();
    const safeCode=input.errorCode&&/^[a-z0-9_:.-]{1,120}$/i.test(input.errorCode)?input.errorCode:'provider_operational_error';
    await this.pool.query(
      'INSERT INTO provider_operational_events (company_id,provider,event_type,error_code) VALUES ($1,$2,$3,$4)',
      [input.companyId??null,input.provider,input.eventType,input.errorCode?safeCode:null]
    );
  }

  async summary(companyId:string):Promise<ProviderOperationalSummary>{
    await this.init();
    const [stateResult,reconcileResult,refundResult,webhookResult]=await Promise.all([
      this.pool.query(
        `SELECT state,COUNT(*)::int AS count
         FROM provider_transaction_intents
         WHERE company_id=$1
         GROUP BY state`,
        [companyId]
      ),
      this.pool.query(
        `SELECT COUNT(*)::int AS pending,
                EXTRACT(EPOCH FROM (now()-MIN(updated_at)))/60.0 AS oldest_age_minutes
         FROM provider_transaction_intents
         WHERE company_id=$1 AND state='RECONCILE_REQUIRED'`,
        [companyId]
      ),
      this.pool.query(
        `SELECT COUNT(*)::int AS pending,
                EXTRACT(EPOCH FROM (now()-MIN(updated_at)))/60.0 AS oldest_age_minutes
         FROM provider_transaction_intents
         WHERE company_id=$1 AND state IN ('REFUND_REQUIRED','REFUND_EXECUTING','REFUND_SUBMITTED')`,
        [companyId]
      ),
      this.pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE created_at>=now()-interval '1 hour')::int AS last_hour,
           COUNT(*) FILTER (WHERE created_at>=now()-interval '24 hours')::int AS last_24_hours
         FROM provider_operational_events
         WHERE event_type='webhook.failed'
           AND (company_id=$1 OR company_id IS NULL)`,
        [companyId]
      )
    ]);

    const transactions:Record<string,number>={};
    for(const row of stateResult.rows) transactions[String(row.state)]=Number(row.count);
    const pending=Number(reconcileResult.rows[0]?.pending??0);
    const oldestRaw=reconcileResult.rows[0]?.oldest_age_minutes;
    const oldestAgeMinutes=oldestRaw===null||oldestRaw===undefined?null:Math.max(0,Number(oldestRaw));
    const refundPending=Number(refundResult.rows[0]?.pending??0);
    const refundOldestRaw=refundResult.rows[0]?.oldest_age_minutes;
    const refundOldestAgeMinutes=refundOldestRaw===null||refundOldestRaw===undefined?null:Math.max(0,Number(refundOldestRaw));
    const lastHour=Number(webhookResult.rows[0]?.last_hour??0);
    const last24Hours=Number(webhookResult.rows[0]?.last_24_hours??0);

    const thresholds={
      reconcileWarn:positiveInt(this.env.PROVIDER_RECONCILE_WARN,1),
      reconcileCritical:positiveInt(this.env.PROVIDER_RECONCILE_CRITICAL,5),
      reconcileAgeWarnMinutes:positiveInt(this.env.PROVIDER_RECONCILE_AGE_WARN_MINUTES,30),
      reconcileAgeCriticalMinutes:positiveInt(this.env.PROVIDER_RECONCILE_AGE_CRITICAL_MINUTES,120),
      webhookFailureWarn:positiveInt(this.env.PROVIDER_WEBHOOK_FAILURE_WARN,3),
      webhookFailureCritical:positiveInt(this.env.PROVIDER_WEBHOOK_FAILURE_CRITICAL,10)
    };
    const alerts:string[]=[];
    let level:ProviderHealthLevel='OK';
    const critical=(message:string)=>{level='CRITICAL';alerts.push(message);};
    const warn=(message:string)=>{if(level==='OK') level='WARN';alerts.push(message);};

    if(pending>=thresholds.reconcileCritical) critical('reconciliation_backlog_critical');
    else if(pending>=thresholds.reconcileWarn) warn('reconciliation_backlog_warning');

    if(oldestAgeMinutes!==null&&oldestAgeMinutes>=thresholds.reconcileAgeCriticalMinutes) critical('reconciliation_age_critical');
    else if(oldestAgeMinutes!==null&&oldestAgeMinutes>=thresholds.reconcileAgeWarnMinutes) warn('reconciliation_age_warning');

    if(refundPending>0) critical('refund_compensation_required');

    if(lastHour>=thresholds.webhookFailureCritical) critical('webhook_failures_critical');
    else if(lastHour>=thresholds.webhookFailureWarn) warn('webhook_failures_warning');

    return {
      companyId,
      level,
      generatedAt:new Date().toISOString(),
      reconciliation:{pending,oldestAgeMinutes},
      compensation:{pendingRefunds:refundPending,oldestAgeMinutes:refundOldestAgeMinutes},
      transactions,
      webhookFailures:{lastHour,last24Hours},
      thresholds,
      alerts
    };
  }
}

function positiveInt(value:string|undefined,fallback:number){
  const parsed=Number(value);
  return Number.isInteger(parsed)&&parsed>0?parsed:fallback;
}
