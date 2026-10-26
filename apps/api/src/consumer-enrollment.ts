import {randomUUID} from 'node:crypto';
import {bindShopIdentity,stripeSavedPaymentAuthorization,type ConsumerCommerceIdentity} from './consumer-commerce-identity.js';

export interface EnrollmentIdentity {
  subjectId:string;
  shopUserPublicId?:string;
  authenticatedAt:string;
  email?:string;
}
export interface EnrollmentChallenge {
  enrollmentId:string;
  subjectId:string;
  shopUserPublicId:string;
  customerId:string;
  setupIntentId:string;
  expiresAt:string;
  consumed:boolean;
}
export interface EnrollmentStore {
  create(challenge:EnrollmentChallenge):Promise<void>;
  get(enrollmentId:string):Promise<EnrollmentChallenge|null>;
  complete(challenge:EnrollmentChallenge,identity:ConsumerCommerceIdentity):Promise<boolean>;
}
function trustedShop(identity:EnrollmentIdentity){
  if(!identity.subjectId.trim()) throw new Error('consumer_subject_required');
  if(!identity.authenticatedAt) throw new Error('consumer_reauthentication_required');
  const shop=identity.shopUserPublicId?.trim();
  if(!shop) throw new Error('shop_identity_claim_required');
  return shop;
}
export async function startConsumerEnrollment(args:{
  identity:EnrollmentIdentity;
  store:EnrollmentStore;
  createSetup:(enrollmentId:string)=>Promise<{customerId:string;setupIntentId:string;clientSecret:string}>;
  now?:Date;
}){
  const shopUserPublicId=trustedShop(args.identity);
  const enrollmentId=randomUUID();
  const expiresAt=new Date((args.now??new Date()).getTime()+10*60*1000).toISOString();
  // Each challenge gets a fresh server-created customer. Never reuse a customer
  // enrolled through the legacy, browser-supplied SetupIntent endpoint.
  const setup=await args.createSetup(enrollmentId);
  if(!/^cus_[A-Za-z0-9_]+$/.test(setup.customerId)||!/^seti_[A-Za-z0-9_]+$/.test(setup.setupIntentId)||!setup.clientSecret){
    throw new Error('stripe_enrollment_setup_invalid');
  }
  await args.store.create({enrollmentId,subjectId:args.identity.subjectId,shopUserPublicId,
    customerId:setup.customerId,setupIntentId:setup.setupIntentId,expiresAt,consumed:false});
  return {enrollmentId,clientSecret:setup.clientSecret};
}
export async function completeConsumerEnrollment(args:{
  identity:EnrollmentIdentity;
  enrollmentId:string;
  store:EnrollmentStore;
  verifySetup:(id:string)=>Promise<{setupIntentId:string;customerId:string;paymentMethodId:string;usage:'off_session'}>;
  now?:Date;
}){
  const shop=trustedShop(args.identity);
  const challenge=await args.store.get(args.enrollmentId);
  if(!challenge||challenge.subjectId!==args.identity.subjectId||challenge.shopUserPublicId!==shop){
    throw new Error('enrollment_identity_mismatch');
  }
  if(challenge.consumed) throw new Error('enrollment_already_consumed');
  const now=args.now??new Date();
  if(!Number.isFinite(Date.parse(challenge.expiresAt))||Date.parse(challenge.expiresAt)<=now.getTime()) throw new Error('enrollment_expired');
  const verified=await args.verifySetup(challenge.setupIntentId);
  if(verified.setupIntentId!==challenge.setupIntentId||verified.customerId!==challenge.customerId||verified.usage!=='off_session'){
    throw new Error('stripe_enrollment_verification_mismatch');
  }
  const identity=bindShopIdentity({subjectId:args.identity.subjectId,shopUserPublicId:shop,
    ...(args.identity.email?{email:args.identity.email}:{}),verifiedAt:args.identity.authenticatedAt,
    paymentAuthorization:{rail:'stripe',reference:verified.setupIntentId,verifiedAt:now.toISOString(),
      customerId:verified.customerId,paymentMethodId:verified.paymentMethodId,usage:'off_session'}});
  stripeSavedPaymentAuthorization(identity);
  if(!await args.store.complete(challenge,identity)) throw new Error('enrollment_expired_or_consumed');
  return {enrolled:true,paymentRail:'stripe',shopIdentityVerified:true};
}

// An allowlist keeps client identity/payment identifiers out of both operations.
export function enrollmentRequest(operation:'start'|'complete',body:unknown):{enrollmentId?:string}{
  if(!body||typeof body!=='object'||Array.isArray(body)) throw new Error('invalid_enrollment_request');
  const value=body as Record<string,unknown>;
  if(Object.keys(value).some(key=>operation==='start'||key!=='enrollmentId')) throw new Error('invalid_enrollment_request');
  if(operation==='start') return {};
  if(typeof value.enrollmentId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.enrollmentId)){
    throw new Error('invalid_enrollment_request');
  }
  return {enrollmentId:value.enrollmentId};
}
export function enrollmentErrorStatus(message:string){
  if(/^(identity_(token_|subject_required$|auth_time_required$|reauthentication_required$)|consumer_reauthentication_required$)/.test(message)) return 401;
  if(/not_configured|stripe_secret_required/.test(message)) return 503;
  if(/^(shop_identity_claim_required|enrollment_|stripe_.*(mismatch|not_succeeded|usage_invalid|id_invalid))/.test(message)) return 409;
  return 400;
}

export class PostgresEnrollmentStore implements EnrollmentStore {
  private initialized=false;
  constructor(private readonly pool:{query(sql:string,params?:unknown[]):Promise<{rows:any[]}>}){}
  private async init(){
    if(this.initialized) return;
    await this.pool.query(`CREATE TABLE IF NOT EXISTS consumer_enrollment_challenges (
      enrollment_id UUID PRIMARY KEY, subject_id TEXT NOT NULL, shop_user_public_id TEXT NOT NULL,
      stripe_customer_id TEXT NOT NULL, setup_intent_id TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ
    )`);
    this.initialized=true;
  }
  async create(c:EnrollmentChallenge){
    await this.init();
    await this.pool.query(`INSERT INTO consumer_enrollment_challenges
      (enrollment_id,subject_id,shop_user_public_id,stripe_customer_id,setup_intent_id,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6)`,[c.enrollmentId,c.subjectId,c.shopUserPublicId,c.customerId,c.setupIntentId,c.expiresAt]);
  }
  async get(enrollmentId:string):Promise<EnrollmentChallenge|null>{
    await this.init();
    const {rows}=await this.pool.query('SELECT * FROM consumer_enrollment_challenges WHERE enrollment_id=$1',[enrollmentId]);
    const c=rows[0];
    return c?{enrollmentId:c.enrollment_id,subjectId:c.subject_id,shopUserPublicId:c.shop_user_public_id,
      customerId:c.stripe_customer_id,setupIntentId:c.setup_intent_id,
      expiresAt:new Date(c.expires_at).toISOString(),consumed:Boolean(c.consumed_at)}:null;
  }
  async complete(c:EnrollmentChallenge,identity:ConsumerCommerceIdentity){
    await this.init();
    const payment=stripeSavedPaymentAuthorization(identity);
    if(!payment||identity.subjectId!==c.subjectId||identity.shopUserPublicId!==c.shopUserPublicId||payment.customerId!==c.customerId||payment.reference!==c.setupIntentId){
      throw new Error('enrollment_identity_mismatch');
    }
    // Consumption and identity persistence are one statement: both commit or both
    // roll back. PostgreSQL rechecks the UPDATE predicate after concurrent locks.
    const result=await this.pool.query(`WITH consumed AS (
      UPDATE consumer_enrollment_challenges SET consumed_at=clock_timestamp()
      WHERE enrollment_id=$1 AND subject_id=$2 AND shop_user_public_id=$3
        AND stripe_customer_id=$4 AND setup_intent_id=$5
        AND consumed_at IS NULL AND expires_at>clock_timestamp()
      RETURNING subject_id,shop_user_public_id,stripe_customer_id,setup_intent_id
    ) INSERT INTO consumer_commerce_identities
      (subject_id,shop_user_public_id,email,shop_identity_verified_at,payment_rail,payment_reference,
       payment_verified_at,stripe_customer_id,stripe_payment_method_id,payment_usage,updated_at)
      SELECT subject_id,shop_user_public_id,$6,$7,'stripe',setup_intent_id,$8,stripe_customer_id,$9,'off_session',now() FROM consumed
      ON CONFLICT(subject_id) DO UPDATE SET shop_user_public_id=EXCLUDED.shop_user_public_id,
        email=EXCLUDED.email,shop_identity_verified_at=EXCLUDED.shop_identity_verified_at,
        payment_rail=EXCLUDED.payment_rail,payment_reference=EXCLUDED.payment_reference,
        payment_verified_at=EXCLUDED.payment_verified_at,stripe_customer_id=EXCLUDED.stripe_customer_id,
        stripe_payment_method_id=EXCLUDED.stripe_payment_method_id,payment_usage=EXCLUDED.payment_usage,updated_at=now()
      RETURNING subject_id`,[c.enrollmentId,c.subjectId,c.shopUserPublicId,c.customerId,c.setupIntentId,
        identity.email??null,identity.shopIdentityVerifiedAt,identity.paymentAuthorization.verifiedAt,payment.paymentMethodId]);
    return result.rows.length===1;
  }
}
