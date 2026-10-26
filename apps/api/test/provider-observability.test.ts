import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresProviderObservabilityStore} from '../dist/provider-observability.js';

function fakePool(input:{
  states?:Array<{state:string;count:number}>;
  pending?:number;
  oldestAgeMinutes?:number|null;
  refundPending?:number;
  refundOldestAgeMinutes?:number|null;
  lastHour?:number;
  last24Hours?:number;
}={}){
  const inserts:any[]=[];
  return {
    inserts,
    async query(sql:string,params:any[]=[]){
      if(sql.includes('CREATE TABLE')||sql.includes('CREATE INDEX')) return {rows:[],rowCount:0};
      if(sql.includes('INSERT INTO provider_operational_events')){
        inserts.push(params);
        return {rows:[],rowCount:1};
      }
      if(sql.includes('GROUP BY state')){
        return {rows:(input.states??[]).map(row=>({state:row.state,count:row.count})),rowCount:(input.states??[]).length};
      }
      if(sql.includes("state='RECONCILE_REQUIRED'")){
        return {rows:[{pending:input.pending??0,oldest_age_minutes:input.oldestAgeMinutes??null}],rowCount:1};
      }
      if(sql.includes("state IN ('REFUND_REQUIRED','REFUND_EXECUTING','REFUND_SUBMITTED')")){
        return {rows:[{pending:input.refundPending??0,oldest_age_minutes:input.refundOldestAgeMinutes??null}],rowCount:1};
      }
      if(sql.includes("event_type='webhook.failed'")){
        return {rows:[{last_hour:input.lastHour??0,last_24_hours:input.last24Hours??0}],rowCount:1};
      }
      throw new Error('unexpected_query:'+sql);
    }
  };
}

test('provider observability reports healthy tenant state',async()=>{
  const pool=fakePool({
    states:[{state:'ORDER_CREATED',count:4}],
    pending:0,
    oldestAgeMinutes:null,
    lastHour:0,
    last24Hours:1
  });
  const store=new PostgresProviderObservabilityStore(pool as any,{});
  const summary=await store.summary('org-a');
  assert.equal(summary.level,'OK');
  assert.equal(summary.reconciliation.pending,0);
  assert.equal(summary.compensation.pendingRefunds,0);
  assert.equal(summary.transactions.ORDER_CREATED,4);
  assert.deepEqual(summary.alerts,[]);
});

test('reconciliation backlog and webhook failures escalate deterministically',async()=>{
  const warningPool=fakePool({pending:1,oldestAgeMinutes:35,lastHour:3,last24Hours:3});
  const warningStore=new PostgresProviderObservabilityStore(warningPool as any,{});
  const warning=await warningStore.summary('org-a');
  assert.equal(warning.level,'WARN');
  assert.ok(warning.alerts.includes('reconciliation_backlog_warning'));
  assert.ok(warning.alerts.includes('reconciliation_age_warning'));
  assert.ok(warning.alerts.includes('webhook_failures_warning'));

  const criticalPool=fakePool({pending:5,oldestAgeMinutes:130,lastHour:10,last24Hours:10});
  const criticalStore=new PostgresProviderObservabilityStore(criticalPool as any,{});
  const critical=await criticalStore.summary('org-a');
  assert.equal(critical.level,'CRITICAL');
  assert.ok(critical.alerts.includes('reconciliation_backlog_critical'));
  assert.ok(critical.alerts.includes('reconciliation_age_critical'));
  assert.ok(critical.alerts.includes('webhook_failures_critical'));
});

test('thresholds are configurable without permitting invalid values',async()=>{
  const pool=fakePool({pending:2,oldestAgeMinutes:15,lastHour:1});
  const store=new PostgresProviderObservabilityStore(pool as any,{
    PROVIDER_RECONCILE_WARN:'2',
    PROVIDER_RECONCILE_CRITICAL:'9',
    PROVIDER_RECONCILE_AGE_WARN_MINUTES:'10',
    PROVIDER_RECONCILE_AGE_CRITICAL_MINUTES:'90',
    PROVIDER_WEBHOOK_FAILURE_WARN:'1',
    PROVIDER_WEBHOOK_FAILURE_CRITICAL:'8'
  });
  const summary=await store.summary('org-a');
  assert.equal(summary.level,'WARN');
  assert.equal(summary.thresholds.reconcileWarn,2);
  assert.equal(summary.thresholds.webhookFailureWarn,1);
});

test('operational event recording sanitizes unsafe error codes',async()=>{
  const pool=fakePool();
  const store=new PostgresProviderObservabilityStore(pool as any,{});
  await store.record({provider:'stripe',eventType:'webhook.failed',errorCode:'Bearer secret value'});
  assert.equal(pool.inserts.length,1);
  assert.equal(pool.inserts[0][1],'stripe');
  assert.equal(pool.inserts[0][2],'webhook.failed');
  assert.equal(pool.inserts[0][3],'provider_operational_error');
});


test('any refund compensation backlog is critical customer-impacting health',async()=>{
  const pool=fakePool({
    states:[{state:'REFUND_REQUIRED',count:1}],
    refundPending:1,
    refundOldestAgeMinutes:4,
    lastHour:0,
    last24Hours:0
  });
  const store=new PostgresProviderObservabilityStore(pool as any,{});
  const summary=await store.summary('org-a');
  assert.equal(summary.level,'CRITICAL');
  assert.equal(summary.compensation.pendingRefunds,1);
  assert.ok(summary.alerts.includes('refund_compensation_required'));
});
