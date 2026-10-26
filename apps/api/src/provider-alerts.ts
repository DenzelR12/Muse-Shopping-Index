import {createHmac} from 'node:crypto';
import type {Pool} from 'pg';
import {PostgresProviderObservabilityStore,type ProviderOperationalSummary} from './provider-observability.js';

type AlertLevel='CRITICAL'|'RECOVERED';

export class PostgresProviderAlertStateStore {
  private initialized=false;
  constructor(private readonly pool:Pool){}

  private async init(){
    if(this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS provider_alert_state (
        company_id TEXT PRIMARY KEY,
        last_level TEXT NOT NULL,
        last_fingerprint TEXT,
        last_sent_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    this.initialized=true;
  }

  async get(companyId:string){
    await this.init();
    const result=await this.pool.query(
      'SELECT company_id,last_level,last_fingerprint,last_sent_at,updated_at FROM provider_alert_state WHERE company_id=$1',
      [companyId]
    );
    const row=result.rows[0];
    return row?{
      companyId:String(row.company_id),
      lastLevel:String(row.last_level),
      lastFingerprint:row.last_fingerprint?String(row.last_fingerprint):undefined,
      lastSentAt:row.last_sent_at?new Date(row.last_sent_at).toISOString():undefined,
      updatedAt:new Date(row.updated_at).toISOString()
    }:null;
  }

  async save(input:{companyId:string;lastLevel:string;lastFingerprint?:string;lastSentAt?:string}){
    await this.init();
    await this.pool.query(
      `INSERT INTO provider_alert_state (company_id,last_level,last_fingerprint,last_sent_at,updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT(company_id) DO UPDATE SET
         last_level=EXCLUDED.last_level,
         last_fingerprint=EXCLUDED.last_fingerprint,
         last_sent_at=EXCLUDED.last_sent_at,
         updated_at=now()`,
      [input.companyId,input.lastLevel,input.lastFingerprint??null,input.lastSentAt??null]
    );
  }
}

export async function listProviderCompanyIds(pool:Pool){
  const result=await pool.query(`
    SELECT DISTINCT company_id FROM (
      SELECT company_id FROM provider_connections
      UNION
      SELECT company_id FROM provider_transaction_intents
    ) ids
    WHERE company_id IS NOT NULL AND company_id<>''
    ORDER BY company_id
  `);
  return result.rows.map(row=>String(row.company_id));
}

export async function dispatchProviderHealthAlerts(args:{
  pool:Pool;
  env?:NodeJS.ProcessEnv;
  fetchImpl?:typeof fetch;
  now?:Date;
}){
  const env=args.env??process.env;
  const endpoint=env.PROVIDER_ALERT_WEBHOOK_URL?.trim();
  const signingSecret=env.PROVIDER_ALERT_SIGNING_SECRET?.trim();
  if(!endpoint||!signingSecret) return {configured:false,checked:0,sent:0,skipped:0};
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||url.username||url.password) throw new Error('provider_alert_webhook_url_invalid');

  const now=args.now??new Date();
  const fetchImpl=args.fetchImpl??fetch;
  const observability=new PostgresProviderObservabilityStore(args.pool,env);
  const states=new PostgresProviderAlertStateStore(args.pool);
  const companyIds=await listProviderCompanyIds(args.pool);
  const cooldownMinutes=positiveInt(env.PROVIDER_ALERT_COOLDOWN_MINUTES,30);
  let sent=0;
  let skipped=0;

  for(const companyId of companyIds){
    const summary=await observability.summary(companyId);
    const prior=await states.get(companyId);
    const fingerprint=summaryFingerprint(summary);
    if(summary.level==='CRITICAL'){
      const lastSentMs=prior?.lastSentAt?new Date(prior.lastSentAt).getTime():0;
      const withinCooldown=lastSentMs>0&&now.getTime()-lastSentMs<cooldownMinutes*60_000;
      if(prior?.lastLevel==='CRITICAL'&&prior.lastFingerprint===fingerprint&&withinCooldown){
        skipped++;
        continue;
      }
      await sendAlert({
        endpoint:url.toString(),
        signingSecret,
        fetchImpl,
        payload:alertPayload('CRITICAL',summary,now)
      });
      await states.save({companyId,lastLevel:'CRITICAL',lastFingerprint:fingerprint,lastSentAt:now.toISOString()});
      sent++;
      continue;
    }

    if(prior?.lastLevel==='CRITICAL'){
      await sendAlert({
        endpoint:url.toString(),
        signingSecret,
        fetchImpl,
        payload:alertPayload('RECOVERED',summary,now)
      });
      await states.save({companyId,lastLevel:summary.level,lastFingerprint:fingerprint,lastSentAt:now.toISOString()});
      sent++;
    }else{
      await states.save({
        companyId,
        lastLevel:summary.level,
        lastFingerprint:fingerprint,
        lastSentAt:prior?.lastSentAt
      });
      skipped++;
    }
  }

  return {configured:true,checked:companyIds.length,sent,skipped};
}

function alertPayload(level:AlertLevel,summary:ProviderOperationalSummary,now:Date){
  return {
    version:1,
    event:'provider.health',
    level,
    companyId:summary.companyId,
    observedLevel:summary.level,
    generatedAt:now.toISOString(),
    alerts:summary.alerts,
    reconciliation:summary.reconciliation,
    compensation:summary.compensation,
    webhookFailures:summary.webhookFailures,
    transactions:summary.transactions
  };
}

async function sendAlert(args:{endpoint:string;signingSecret:string;fetchImpl:typeof fetch;payload:Record<string,unknown>}){
  const body=JSON.stringify(args.payload);
  const timestamp=String(Math.floor(Date.now()/1000));
  const signature=createHmac('sha256',args.signingSecret).update(timestamp+'.'+body).digest('hex');
  const response=await args.fetchImpl(args.endpoint,{
    method:'POST',
    headers:{
      'content-type':'application/json',
      'user-agent':'gift-signal-provider-alerts/1',
      'x-gift-signal-timestamp':timestamp,
      'x-gift-signal-signature':'v1='+signature
    },
    body
  });
  if(!response.ok) throw new Error('provider_alert_delivery_failed:'+response.status);
}

function summaryFingerprint(summary:ProviderOperationalSummary){
  return JSON.stringify({
    level:summary.level,
    alerts:[...summary.alerts].sort(),
    pending:summary.reconciliation.pending,
    webhookFailures:summary.webhookFailures.lastHour
  });
}

function positiveInt(value:string|undefined,fallback:number){
  const parsed=Number(value);
  return Number.isInteger(parsed)&&parsed>0?parsed:fallback;
}
