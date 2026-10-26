import test from 'node:test';
import assert from 'node:assert/strict';
import {startConsumerEnrollment,completeConsumerEnrollment,enrollmentRequest,enrollmentErrorStatus,PostgresEnrollmentStore,type EnrollmentChallenge,type EnrollmentStore} from '../dist/consumer-enrollment.js';
import {PostgresConsumerCommerceIdentityStore} from '../dist/consumer-commerce-identity.js';
import {Pool} from 'pg';

const now=new Date('2026-10-25T22:00:00Z');
const identity={subjectId:'buyer',shopUserPublicId:'shop-buyer',authenticatedAt:now.toISOString(),email:'verified@example.com'};
function fixture(){
  let challenge:EnrollmentChallenge|null=null;
  const saved:any[]=[];
  let verifies=0;
  const store:EnrollmentStore={
    async create(c){challenge={...c};},
    async get(){return challenge?{...challenge}:null;},
    async complete(_c,i){if(challenge!.consumed) return false;challenge!.consumed=true;saved.push(i);return true;}
  };
  const start=()=>startConsumerEnrollment({identity,store,now,createSetup:async()=>({customerId:'cus_owned',setupIntentId:'seti_owned',clientSecret:'secret'})});
  const complete=(overrides:any={})=>completeConsumerEnrollment({identity,store,now,enrollmentId:challenge!.enrollmentId,
    verifySetup:async(id)=>{verifies++;assert.equal(id,'seti_owned');return {setupIntentId:id,customerId:'cus_owned',paymentMethodId:'pm_owned',usage:'off_session'};},...overrides});
  return {start,complete,saved,get challenge(){return challenge!;},get verifies(){return verifies;}};
}
test('start returns only enrollment ID and client secret; complete binds verified identity',async()=>{
  const f=fixture();const result=await f.start();
  assert.deepEqual(Object.keys(result).sort(),['clientSecret','enrollmentId']);
  assert.equal(Date.parse(f.challenge.expiresAt)-now.getTime(),600000);
  assert.deepEqual(await f.complete(),{enrolled:true,paymentRail:'stripe',shopIdentityVerified:true});
  assert.equal(f.saved[0].subjectId,identity.subjectId);
  assert.equal(f.saved[0].email,identity.email);
  assert.equal(f.saved[0].paymentAuthorization.customerId,'cus_owned');
});
for(const [name,overrides,error] of [
  ['cross subject',{identity:{...identity,subjectId:'attacker'}},/identity_mismatch/],
  ['wrong Shop user',{identity:{...identity,shopUserPublicId:'other'}},/identity_mismatch/],
  ['missing Shop claim',{identity:{...identity,shopUserPublicId:undefined}},/shop_identity_claim_required/],
  ['expired',{now:new Date(now.getTime()+600000)},/enrollment_expired/]
] as const){
  test(`rejects ${name} before Stripe lookup`,async()=>{
    const f=fixture();await f.start();await assert.rejects(f.complete(overrides),error);
    assert.equal(f.verifies,0);assert.equal(f.saved.length,0);
  });
}
test('missing Shop claim fails before creating Stripe resources',async()=>{
  await assert.rejects(startConsumerEnrollment({identity:{...identity,shopUserPublicId:undefined},store:{} as any,
    createSetup:async()=>{throw Error('must_not_call');}}),/shop_identity_claim_required/);
});
test('rejects replay and allows exactly one concurrent completion',async()=>{
  const f=fixture();await f.start();
  const results=await Promise.allSettled([f.complete(),f.complete()]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.saved.length,1);
  await assert.rejects(f.complete(),/already_consumed/);
});
for(const bad of [{setupIntentId:'seti_other'},{customerId:'cus_other'},{usage:'on_session'},{paymentMethodId:'bad'}]){
  test(`rejects Stripe verification mismatch ${Object.keys(bad)[0]}`,async()=>{
    const f=fixture();await f.start();
    await assert.rejects(f.complete({verifySetup:async()=>({setupIntentId:'seti_owned',customerId:'cus_owned',paymentMethodId:'pm_owned',usage:'off_session',...bad})}),/mismatch|invalid/);
    assert.equal(f.saved.length,0);assert.equal(f.challenge.consumed,false);
  });
}
test('unknown challenge fails closed',async()=>{
  await assert.rejects(completeConsumerEnrollment({identity,enrollmentId:'missing',store:{get:async()=>null} as any,
    verifySetup:async()=>{throw Error('must_not_call');}}),/identity_mismatch/);
});
test('browser request allowlist excludes all payment and identity substitutions',()=>{
  const enrollmentId='b87f6ef8-9978-4ad8-8879-54e65819002c';
  assert.deepEqual(enrollmentRequest('start',{}),{});
  assert.deepEqual(enrollmentRequest('complete',{enrollmentId}),{enrollmentId});
  for(const key of ['customerId','paymentMethodId','setupIntentId','subjectId','shopUserPublicId','email']){
    assert.throws(()=>enrollmentRequest('start',{[key]:'attacker'}),/invalid_enrollment_request/);
    assert.throws(()=>enrollmentRequest('complete',{enrollmentId,[key]:'attacker'}),/invalid_enrollment_request/);
  }
  for(const value of [null,[],{},'id',{enrollmentId:'seti_arbitrary'}]) assert.throws(()=>enrollmentRequest('complete',value));
});
test('HTTP status distinguishes authentication from enrollment state',()=>{
  for(const message of ['identity_token_required','identity_token_invalid','identity_reauthentication_required','identity_auth_time_required']) assert.equal(enrollmentErrorStatus(message),401);
  for(const message of ['shop_identity_claim_required','enrollment_expired','enrollment_already_consumed','stripe_setup_intent_not_succeeded','stripe_enrollment_verification_mismatch']) assert.equal(enrollmentErrorStatus(message),409);
  assert.equal(enrollmentErrorStatus('invalid_enrollment_request'),400);
  assert.equal(enrollmentErrorStatus('consumer_commerce_enrollment_not_configured'),503);
});

test('PostgreSQL atomically consumes once and rolls back consumption if identity persistence fails',
  {skip:!process.env.ENROLLMENT_TEST_DATABASE_URL},async()=>{
  const pool=new Pool({connectionString:process.env.ENROLLMENT_TEST_DATABASE_URL});
  try{
    const identities=new PostgresConsumerCommerceIdentityStore(pool);
    await identities.ensureReady();
    const store=new PostgresEnrollmentStore(pool);
    const subjectId='test-'+crypto.randomUUID();
    const buyer={...identity,subjectId};
    const start=await startConsumerEnrollment({identity:buyer,store,createSetup:async()=>({customerId:'cus_db',setupIntentId:'seti_'+crypto.randomUUID().replaceAll('-',''),clientSecret:'secret'})});
    const c=(await store.get(start.enrollmentId))!;
    const args={identity:buyer,enrollmentId:start.enrollmentId,store,verifySetup:async()=>({setupIntentId:c.setupIntentId,customerId:'cus_db',paymentMethodId:'pm_db',usage:'off_session' as const})};
    // A trigger simulates persistence failure after the challenge UPDATE.
    await pool.query(`CREATE OR REPLACE FUNCTION reject_test_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.subject_id LIKE 'test-%' THEN RAISE EXCEPTION 'injected_identity_failure'; END IF; RETURN NEW; END $$`);
    await pool.query('CREATE TRIGGER reject_test_enrollment BEFORE INSERT ON consumer_commerce_identities FOR EACH ROW EXECUTE FUNCTION reject_test_enrollment()');
    try{await assert.rejects(completeConsumerEnrollment(args),/injected_identity_failure/);}
    finally{await pool.query('DROP TRIGGER reject_test_enrollment ON consumer_commerce_identities');}
    assert.equal((await store.get(start.enrollmentId))!.consumed,false);
    const results=await Promise.allSettled([completeConsumerEnrollment(args),completeConsumerEnrollment(args)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await identities.get(subjectId))!.paymentAuthorization.reference,c.setupIntentId);
    assert.equal((await store.get(start.enrollmentId))!.consumed,true);
    const expired={...c,enrollmentId:crypto.randomUUID(),setupIntentId:c.setupIntentId+'expired',expiresAt:new Date(Date.now()-1000).toISOString(),consumed:false};
    await store.create(expired);
    const saved=(await identities.get(subjectId))!;
    saved.paymentAuthorization.reference=expired.setupIntentId;
    assert.equal(await store.complete(expired,saved),false);
    await pool.query('DELETE FROM consumer_commerce_identities WHERE subject_id=$1',[subjectId]);
    await pool.query('DELETE FROM consumer_enrollment_challenges WHERE subject_id=$1',[subjectId]);
  }finally{await pool.end();}
});
