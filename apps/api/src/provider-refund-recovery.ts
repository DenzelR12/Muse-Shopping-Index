import {getStripeRefund} from '@gift-signal/payments';
import type {Pool} from 'pg';
import type {PostgresProviderTransactionIntentStore} from './provider-transaction-store.js';
import type {ProviderSecurityAuditor} from './provider-security-audit.js';

export async function reconcileSubmittedRefunds(args:{
  intents:PostgresProviderTransactionIntentStore;
  auditor?:ProviderSecurityAuditor;
  stripeSecret:string;
  fetchImpl?:typeof fetch;
  now?:Date;
  staleMinutes?:number;
  limit?:number;
}){
  if(!args.stripeSecret) throw new Error('stripe_secret_required');
  const now=args.now??new Date();
  const staleMinutes=Math.max(1,Math.min(24*60,Math.trunc(args.staleMinutes??10)));
  const olderThan=new Date(now.getTime()-staleMinutes*60_000);
  const items=await args.intents.listStaleRefundSubmitted(olderThan,args.limit??100);
  let refunded=0;
  let reopened=0;
  let pending=0;
  let failed=0;

  for(const intent of items){
    if(!intent.refundId){failed++;continue;}
    try{
      const refund=await getStripeRefund({
        refundId:intent.refundId,
        secretKey:args.stripeSecret,
        fetchImpl:args.fetchImpl
      });
      if(refund.status==='succeeded'){
        const updated=await args.intents.markRefunded(intent.companyId,intent.draftId,refund.refundId);
        if(updated){
          refunded++;
          await args.auditor?.record('provider.transaction.refunded',{
            companyId:intent.companyId,
            provider:intent.paymentProvider,
            externalAccountId:intent.paymentExternalAccountId,
            draftId:intent.draftId,
            amount:intent.amount,
            currency:intent.currency
          });
        }
        continue;
      }
      if(refund.status==='failed'||refund.status==='canceled'){
        const updated=await args.intents.markRefundFailed(intent.companyId,intent.draftId,refund.refundId);
        if(updated){
          reopened++;
          await args.auditor?.record('provider.transaction.refund_failed',{
            companyId:intent.companyId,
            provider:intent.paymentProvider,
            externalAccountId:intent.paymentExternalAccountId,
            draftId:intent.draftId,
            amount:intent.amount,
            currency:intent.currency
          });
        }
        continue;
      }
      pending++;
    }catch{
      failed++;
    }
  }
  return {checked:items.length,refunded,reopened,pending,failed,olderThan:olderThan.toISOString()};
}


const REFUND_RECOVERY_LOCK_KEY=734912;

export async function runRefundRecoveryWithAdvisoryLock(args:{
  pool:Pool;
  intents:PostgresProviderTransactionIntentStore;
  auditor?:ProviderSecurityAuditor;
  stripeSecret:string;
  fetchImpl?:typeof fetch;
  now?:Date;
  staleMinutes?:number;
  limit?:number;
}){
  const client=await args.pool.connect();
  let locked=false;
  try{
    const result=await client.query('SELECT pg_try_advisory_lock($1) AS locked',[REFUND_RECOVERY_LOCK_KEY]);
    locked=Boolean(result.rows[0]?.locked);
    if(!locked) return {locked:false,skipped:true} as const;
    const recovery=await reconcileSubmittedRefunds({
      intents:args.intents,
      auditor:args.auditor,
      stripeSecret:args.stripeSecret,
      fetchImpl:args.fetchImpl,
      now:args.now,
      staleMinutes:args.staleMinutes,
      limit:args.limit
    });
    return {locked:true,skipped:false,...recovery} as const;
  }finally{
    if(locked) await client.query('SELECT pg_advisory_unlock($1)',[REFUND_RECOVERY_LOCK_KEY]).catch(()=>undefined);
    client.release();
  }
}
