import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchProviderHealthAlerts} from '../dist/provider-alerts.js';

function fakePool(){
  let mode:'critical'|'healthy'='critical';
  let alertState:any=null;
  return {
    setMode(next:'critical'|'healthy'){mode=next;},
    async query(sql:string,params:any[]=[]){
      if(sql.includes('CREATE TABLE')||sql.includes('CREATE INDEX')) return {rows:[],rowCount:0};
      if(sql.includes('SELECT DISTINCT company_id FROM')){
        return {rows:[{company_id:'org-a'}],rowCount:1};
      }
      if(sql.includes('GROUP BY state')){
        return {rows:mode==='critical'?[{state:'RECONCILE_REQUIRED',count:5}]:[{state:'ORDER_CREATED',count:3}],rowCount:1};
      }
      if(sql.includes("state='RECONCILE_REQUIRED'")){
        return {rows:[mode==='critical'?{pending:5,oldest_age_minutes:130}:{pending:0,oldest_age_minutes:null}],rowCount:1};
      }
      if(sql.includes("state IN ('REFUND_REQUIRED','REFUND_EXECUTING','REFUND_SUBMITTED')")){
        return {rows:[{pending:0,oldest_age_minutes:null}],rowCount:1};
      }
      if(sql.includes("event_type='webhook.failed'")){
        return {rows:[mode==='critical'?{last_hour:10,last_24_hours:10}:{last_hour:0,last_24_hours:0}],rowCount:1};
      }
      if(sql.includes('FROM provider_alert_state WHERE company_id=$1')){
        return {rows:alertState?[alertState]:[],rowCount:alertState?1:0};
      }
      if(sql.includes('INSERT INTO provider_alert_state')){
        alertState={
          company_id:params[0],
          last_level:params[1],
          last_fingerprint:params[2],
          last_sent_at:params[3]?new Date(params[3]):null,
          updated_at:new Date('2026-10-25T02:00:00Z')
        };
        return {rows:[],rowCount:1};
      }
      throw new Error('unexpected_query:'+sql);
    }
  };
}

test('critical provider health sends once and suppresses duplicate within cooldown',async()=>{
  const pool=fakePool();
  const deliveries:any[]=[];
  const fetchImpl=async(_url:any,init:any)=>{
    deliveries.push(init);
    return new Response('',{status:200});
  };
  const env={
    PROVIDER_ALERT_WEBHOOK_URL:'https://alerts.example.test/gift-signal',
    PROVIDER_ALERT_SIGNING_SECRET:'signing-secret'
  };
  const first=await dispatchProviderHealthAlerts({
    pool:pool as any,env,fetchImpl:fetchImpl as any,now:new Date('2026-10-25T02:00:00Z')
  });
  assert.equal(first.sent,1);
  assert.equal(deliveries.length,1);
  const body=JSON.parse(String(deliveries[0].body));
  assert.equal(body.level,'CRITICAL');
  assert.equal(body.companyId,'org-a');
  assert.equal(body.compensation.pendingRefunds,0);
  assert.match(String(deliveries[0].headers['x-gift-signal-signature']),/^v1=[a-f0-9]{64}$/);

  const second=await dispatchProviderHealthAlerts({
    pool:pool as any,env,fetchImpl:fetchImpl as any,now:new Date('2026-10-25T02:10:00Z')
  });
  assert.equal(second.sent,0);
  assert.equal(second.skipped,1);
  assert.equal(deliveries.length,1);
});

test('recovery sends once after a critical alert',async()=>{
  const pool=fakePool();
  const levels:string[]=[];
  const fetchImpl=async(_url:any,init:any)=>{
    levels.push(JSON.parse(String(init.body)).level);
    return new Response('',{status:200});
  };
  const env={
    PROVIDER_ALERT_WEBHOOK_URL:'https://alerts.example.test/gift-signal',
    PROVIDER_ALERT_SIGNING_SECRET:'signing-secret'
  };
  await dispatchProviderHealthAlerts({
    pool:pool as any,env,fetchImpl:fetchImpl as any,now:new Date('2026-10-25T02:00:00Z')
  });
  pool.setMode('healthy');
  const recovered=await dispatchProviderHealthAlerts({
    pool:pool as any,env,fetchImpl:fetchImpl as any,now:new Date('2026-10-25T02:05:00Z')
  });
  assert.equal(recovered.sent,1);
  assert.deepEqual(levels,['CRITICAL','RECOVERED']);

  const stable=await dispatchProviderHealthAlerts({
    pool:pool as any,env,fetchImpl:fetchImpl as any,now:new Date('2026-10-25T02:10:00Z')
  });
  assert.equal(stable.sent,0);
  assert.deepEqual(levels,['CRITICAL','RECOVERED']);
});

test('alert delivery refuses insecure webhook destinations',async()=>{
  const pool=fakePool();
  await assert.rejects(
    dispatchProviderHealthAlerts({
      pool:pool as any,
      env:{
        PROVIDER_ALERT_WEBHOOK_URL:'http://alerts.example.test/gift-signal',
        PROVIDER_ALERT_SIGNING_SECRET:'signing-secret'
      }
    }),
    /provider_alert_webhook_url_invalid/
  );
});
