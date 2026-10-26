import {Pool} from 'pg';
import {PostgresSecurityAuditSink} from '@gift-signal/mcp-gateway';
import {PostgresProviderTransactionIntentStore} from './provider-transaction-store.js';
import {ProviderSecurityAuditor} from './provider-security-audit.js';
import {reconcileSubmittedRefunds} from './provider-refund-recovery.js';

async function main(){
  const databaseUrl=process.env.DATABASE_URL;
  const stripeSecret=process.env.STRIPE_SECRET_KEY;
  if(!databaseUrl) throw new Error('database_url_required');
  if(!stripeSecret) throw new Error('stripe_secret_required');
  const pool=new Pool({connectionString:databaseUrl,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined});
  try{
    const intents=new PostgresProviderTransactionIntentStore(pool);
    const auditSink=process.env.AUDIT_SIGNING_SECRET?new PostgresSecurityAuditSink(pool,process.env.AUDIT_SIGNING_SECRET):undefined;
    const auditor=auditSink?new ProviderSecurityAuditor(auditSink):undefined;
    const result=await reconcileSubmittedRefunds({
      intents,
      auditor,
      stripeSecret,
      staleMinutes:Number(process.env.PROVIDER_REFUND_RECOVERY_STALE_MINUTES??10),
      limit:Number(process.env.PROVIDER_REFUND_RECOVERY_LIMIT??100)
    });
    console.log(JSON.stringify({event:'provider_refund_recovery',...result}));
  }finally{
    await pool.end();
  }
}

main().catch(error=>{
  console.error(JSON.stringify({event:'provider_refund_recovery_failed',error:error instanceof Error?error.message:'unknown_error'}));
  process.exit(1);
});
