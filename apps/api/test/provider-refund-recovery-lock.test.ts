import test from 'node:test';
import assert from 'node:assert/strict';
import {runRefundRecoveryWithAdvisoryLock} from '../dist/provider-refund-recovery.js';

function pool(lock:boolean){
  const queries:any[]=[];
  const client={
    async query(sql:string,params:any[]=[]){
      queries.push({sql,params});
      if(sql.includes('pg_try_advisory_lock')) return {rows:[{locked:lock}],rowCount:1};
      if(sql.includes('pg_advisory_unlock')) return {rows:[{pg_advisory_unlock:true}],rowCount:1};
      throw new Error('unexpected_query:'+sql);
    },
    release(){queries.push({release:true});}
  };
  return {
    queries,
    async connect(){return client;}
  };
}

test('only advisory-lock holder runs refund recovery',async()=>{
  const db=pool(true);
  let listed=0;
  const intents={
    async listStaleRefundSubmitted(){listed++;return [];}
  };
  const result=await runRefundRecoveryWithAdvisoryLock({
    pool:db as any,
    intents:intents as any,
    stripeSecret:'sk_test',
    now:new Date('2026-10-25T03:00:00Z')
  });
  assert.equal(result.locked,true);
  assert.equal(result.skipped,false);
  assert.equal(listed,1);
  assert.ok(db.queries.some((q:any)=>String(q.sql??'').includes('pg_advisory_unlock')));
});

test('non-lock holder skips without touching refund rows',async()=>{
  const db=pool(false);
  let listed=0;
  const intents={
    async listStaleRefundSubmitted(){listed++;return [];}
  };
  const result=await runRefundRecoveryWithAdvisoryLock({
    pool:db as any,
    intents:intents as any,
    stripeSecret:'sk_test'
  });
  assert.equal(result.locked,false);
  assert.equal(result.skipped,true);
  assert.equal(listed,0);
  assert.equal(db.queries.filter((q:any)=>String(q.sql??'').includes('pg_advisory_unlock')).length,0);
});
