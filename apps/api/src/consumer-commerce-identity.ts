export type ConsumerPaymentRail='shop_pay'|'stripe';

export interface ConsumerCommerceIdentity {
  subjectId:string;
  shopUserPublicId:string;
  email?:string;
  shopIdentityVerifiedAt:string;
  paymentAuthorization:
    | {
        rail:'shop_pay';
        reference:string;
        verifiedAt:string;
      }
    | {
        rail:'stripe';
        reference:string;
        verifiedAt:string;
        customerId:string;
        paymentMethodId:string;
        usage:'off_session';
      };
}

export interface ConsumerCommitGate {
  ready:boolean;
  missing:Array<'shop_identity'|'payment_authorization'|'explicit_approval'>;
}

export function consumerCommitGate(args:{
  identity?:ConsumerCommerceIdentity|null;
  approved:boolean;
}):ConsumerCommitGate{
  const missing:ConsumerCommitGate['missing']=[];
  const identity=args.identity;
  if(!identity?.shopUserPublicId?.trim()||!identity.shopIdentityVerifiedAt) missing.push('shop_identity');
  if(!identity?.paymentAuthorization?.reference?.trim()||!identity.paymentAuthorization.verifiedAt){
    missing.push('payment_authorization');
  }
  if(args.approved!==true) missing.push('explicit_approval');
  return {ready:missing.length===0,missing};
}

export function bindShopIdentity(args:{
  subjectId:string;
  shopUserPublicId:string;
  email?:string;
  verifiedAt:string;
  paymentAuthorization:ConsumerCommerceIdentity['paymentAuthorization'];
}):ConsumerCommerceIdentity{
  if(!args.subjectId.trim()) throw new Error('consumer_subject_required');
  if(!args.shopUserPublicId.trim()) throw new Error('shop_user_public_id_required');
  if(!args.verifiedAt) throw new Error('shop_identity_verification_required');
  if(!args.paymentAuthorization.reference.trim()||!args.paymentAuthorization.verifiedAt){
    throw new Error('payment_authorization_required');
  }
  return {
    subjectId:args.subjectId,
    shopUserPublicId:args.shopUserPublicId,
    ...(args.email?{email:args.email}:{}),
    shopIdentityVerifiedAt:args.verifiedAt,
    paymentAuthorization:{...args.paymentAuthorization}
  };
}


export interface StripeSavedPaymentAuthorization {
  reference:string;
  customerId:string;
  paymentMethodId:string;
  usage:'off_session';
}

export function stripeSavedPaymentAuthorization(identity:ConsumerCommerceIdentity):StripeSavedPaymentAuthorization|null{
  const authorization=identity.paymentAuthorization;
  if(authorization.rail!=='stripe') return null;
  if(!/^cus_[A-Za-z0-9_]+$/.test(authorization.customerId)) throw new Error('stripe_customer_id_invalid');
  if(!/^pm_[A-Za-z0-9_]+$/.test(authorization.paymentMethodId)) throw new Error('stripe_payment_method_id_invalid');
  if(authorization.usage!=='off_session') throw new Error('stripe_payment_usage_invalid');
  return {
    reference:authorization.reference,
    customerId:authorization.customerId,
    paymentMethodId:authorization.paymentMethodId,
    usage:'off_session'
  };
}


export class PostgresConsumerCommerceIdentityStore {
  private initialized=false;
  constructor(private readonly pool:{query(sql:string,params?:unknown[]):Promise<{rows:any[]}>}){}

  private async init(){
    if(this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS consumer_commerce_identities (
        subject_id TEXT PRIMARY KEY,
        shop_user_public_id TEXT NOT NULL,
        email TEXT,
        shop_identity_verified_at TIMESTAMPTZ NOT NULL,
        payment_rail TEXT NOT NULL,
        payment_reference TEXT NOT NULL,
        payment_verified_at TIMESTAMPTZ NOT NULL,
        stripe_customer_id TEXT,
        stripe_payment_method_id TEXT,
        payment_usage TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    this.initialized=true;
  }

  async ensureReady(){await this.init();}

  async save(identity:ConsumerCommerceIdentity){
    await this.init();
    const stripe=identity.paymentAuthorization.rail==='stripe'?stripeSavedPaymentAuthorization(identity):null;
    await this.pool.query(
      `INSERT INTO consumer_commerce_identities
       (subject_id,shop_user_public_id,email,shop_identity_verified_at,payment_rail,payment_reference,payment_verified_at,stripe_customer_id,stripe_payment_method_id,payment_usage,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
       ON CONFLICT(subject_id) DO UPDATE SET
         shop_user_public_id=EXCLUDED.shop_user_public_id,
         email=EXCLUDED.email,
         shop_identity_verified_at=EXCLUDED.shop_identity_verified_at,
         payment_rail=EXCLUDED.payment_rail,
         payment_reference=EXCLUDED.payment_reference,
         payment_verified_at=EXCLUDED.payment_verified_at,
         stripe_customer_id=EXCLUDED.stripe_customer_id,
         stripe_payment_method_id=EXCLUDED.stripe_payment_method_id,
         payment_usage=EXCLUDED.payment_usage,
         updated_at=now()`,
      [
        identity.subjectId,
        identity.shopUserPublicId,
        identity.email??null,
        identity.shopIdentityVerifiedAt,
        identity.paymentAuthorization.rail,
        identity.paymentAuthorization.reference,
        identity.paymentAuthorization.verifiedAt,
        stripe?.customerId??null,
        stripe?.paymentMethodId??null,
        stripe?.usage??null
      ]
    );
  }

  async get(subjectId:string):Promise<ConsumerCommerceIdentity|null>{
    await this.init();
    const normalized=subjectId.trim();
    if(!normalized) throw new Error('consumer_subject_required');
    const result=await this.pool.query(
      `SELECT subject_id,shop_user_public_id,email,shop_identity_verified_at,payment_rail,payment_reference,
              payment_verified_at,stripe_customer_id,stripe_payment_method_id,payment_usage
       FROM consumer_commerce_identities
       WHERE subject_id=$1
       LIMIT 1`,
      [normalized]
    );
    const value=result.rows[0];
    if(!value) return null;
    const rail=String(value.payment_rail);
    const base={
      subjectId:String(value.subject_id),
      shopUserPublicId:String(value.shop_user_public_id),
      ...(value.email?{email:String(value.email)}:{}),
      shopIdentityVerifiedAt:new Date(value.shop_identity_verified_at).toISOString()
    };
    if(rail==='shop_pay'){
      return {
        ...base,
        paymentAuthorization:{
          rail:'shop_pay',
          reference:String(value.payment_reference),
          verifiedAt:new Date(value.payment_verified_at).toISOString()
        }
      };
    }
    if(rail!=='stripe') throw new Error('consumer_payment_rail_invalid');
    const identity:ConsumerCommerceIdentity={
      ...base,
      paymentAuthorization:{
        rail:'stripe',
        reference:String(value.payment_reference),
        verifiedAt:new Date(value.payment_verified_at).toISOString(),
        customerId:String(value.stripe_customer_id??''),
        paymentMethodId:String(value.stripe_payment_method_id??''),
        usage:String(value.payment_usage??'') as 'off_session'
      }
    };
    stripeSavedPaymentAuthorization(identity);
    return identity;
  }

  async resolveStripeSavedPayment(subjectId:string):Promise<StripeSavedPaymentAuthorization|null>{
    const identity=await this.get(subjectId);
    if(!identity) return null;
    return stripeSavedPaymentAuthorization(identity);
  }
}
