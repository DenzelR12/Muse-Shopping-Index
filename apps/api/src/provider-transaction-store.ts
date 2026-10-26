import type {Pool} from 'pg';

export type ProviderTransactionState='CHECKOUT_PENDING'|'DRAFT_PREPARING'|'CHECKOUT_CREATED'|'PAYMENT_FALLBACK_PENDING'|'ORDER_EXECUTING'|'ORDER_CREATED'|'RECONCILE_REQUIRED'|'REFUND_REQUIRED'|'REFUND_EXECUTING'|'REFUND_SUBMITTED'|'REFUNDED';

export interface ProviderTransactionIntent {
  companyId:string;
  draftId:string;
  paymentProvider:string;
  paymentExternalAccountId:string;
  consumerSubjectId?:string;
  fulfillmentProvider:string;
  fulfillmentExternalAccountId:string;
  fulfillmentPayload:Record<string,unknown>;
  amount:number;
  currency:string;
  checkoutSessionId?:string;
  paymentReference?:string;
  paymentReferenceKind?:'checkout_session'|'payment_intent';
  providerOrderId?:string;
  providerDraftOrderId?:string;
  approvalJti?:string;
  reconciliationNote?:string;
  refundId?:string;
  state:ProviderTransactionState;
  createdAt:string;
  updatedAt:string;
}

export class PostgresProviderTransactionIntentStore {
  private initialized=false;
  constructor(private readonly pool:Pool){}

  private async init(){
    if(this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS provider_transaction_intents (
        company_id TEXT NOT NULL,
        draft_id TEXT NOT NULL,
        payment_provider TEXT NOT NULL,
        payment_external_account_id TEXT NOT NULL,
        consumer_subject_id TEXT,
        fulfillment_provider TEXT NOT NULL,
        fulfillment_external_account_id TEXT NOT NULL,
        fulfillment_payload JSONB NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        currency TEXT NOT NULL,
        checkout_session_id TEXT UNIQUE,
        payment_reference TEXT UNIQUE,
        payment_reference_kind TEXT,
        provider_order_id TEXT,
        provider_draft_order_id TEXT,
        approval_jti TEXT,
        reconciliation_note TEXT,
        refund_id TEXT,
        state TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY(company_id,draft_id)
      )
    `);
    await this.pool.query(`ALTER TABLE provider_transaction_intents ADD COLUMN IF NOT EXISTS consumer_subject_id TEXT`);
    await this.pool.query(`ALTER TABLE provider_transaction_intents ADD COLUMN IF NOT EXISTS provider_draft_order_id TEXT`);
    await this.pool.query(`ALTER TABLE provider_transaction_intents ADD COLUMN IF NOT EXISTS payment_reference TEXT UNIQUE`);
    await this.pool.query(`ALTER TABLE provider_transaction_intents ADD COLUMN IF NOT EXISTS payment_reference_kind TEXT`);
    await this.pool.query(`ALTER TABLE provider_transaction_intents ADD COLUMN IF NOT EXISTS approval_jti TEXT`);
    await this.pool.query(`ALTER TABLE provider_transaction_intents ADD COLUMN IF NOT EXISTS reconciliation_note TEXT`);
    await this.pool.query(`ALTER TABLE provider_transaction_intents ADD COLUMN IF NOT EXISTS refund_id TEXT`);
    this.initialized=true;
  }

  async createPending(input:Omit<ProviderTransactionIntent,'checkoutSessionId'|'providerOrderId'|'state'|'createdAt'|'updatedAt'>){
    await this.init();
    await this.pool.query(
      `INSERT INTO provider_transaction_intents
       (company_id,draft_id,payment_provider,payment_external_account_id,consumer_subject_id,fulfillment_provider,fulfillment_external_account_id,fulfillment_payload,amount,currency,state,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'CHECKOUT_PENDING',now())
       ON CONFLICT(company_id,draft_id) DO NOTHING`,
      [
        input.companyId,input.draftId,input.paymentProvider,input.paymentExternalAccountId,input.consumerSubjectId??null,
        input.fulfillmentProvider,input.fulfillmentExternalAccountId,JSON.stringify(input.fulfillmentPayload),
        input.amount,input.currency
      ]
    );
    const existing=await this.get(input.companyId,input.draftId);
    if(!existing) throw new Error('provider_transaction_intent_create_failed');
    const same=
      existing.paymentProvider===input.paymentProvider&&
      existing.paymentExternalAccountId===input.paymentExternalAccountId&&
      (existing.consumerSubjectId??undefined)===(input.consumerSubjectId??undefined)&&
      existing.fulfillmentProvider===input.fulfillmentProvider&&
      existing.fulfillmentExternalAccountId===input.fulfillmentExternalAccountId&&
      existing.amount===input.amount&&
      existing.currency===input.currency&&
      JSON.stringify(existing.fulfillmentPayload)===JSON.stringify(input.fulfillmentPayload);
    if(!same) throw new Error('provider_transaction_draft_conflict');
    return existing;
  }


  async authorizePending(companyId:string,draftId:string,approvalJti:string){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET approval_jti=COALESCE(approval_jti,$3),updated_at=now()
       WHERE company_id=$1 AND draft_id=$2
         AND state='CHECKOUT_PENDING'
         AND (approval_jti IS NULL OR approval_jti=$3)
       RETURNING *`,
      [companyId,draftId,approvalJti]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async claimDraftPreparation(companyId:string,draftId:string){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET state='DRAFT_PREPARING',updated_at=now()
       WHERE company_id=$1 AND draft_id=$2 AND state='CHECKOUT_PENDING' AND provider_draft_order_id IS NULL
       RETURNING *`,
      [companyId,draftId]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async reclaimStaleDraftPreparation(companyId:string,draftId:string,olderThan:Date){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET updated_at=now()
       WHERE company_id=$1 AND draft_id=$2
         AND state='DRAFT_PREPARING'
         AND provider_draft_order_id IS NULL
         AND updated_at <= $3
       RETURNING *`,
      [companyId,draftId,olderThan.toISOString()]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async attachProviderDraftOrder(companyId:string,draftId:string,providerDraftOrderId:string){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET provider_draft_order_id=COALESCE(provider_draft_order_id,$3),state='CHECKOUT_PENDING',updated_at=now()
       WHERE company_id=$1 AND draft_id=$2
         AND state IN ('DRAFT_PREPARING','CHECKOUT_PENDING')
         AND (provider_draft_order_id IS NULL OR provider_draft_order_id=$3)
       RETURNING *`,
      [companyId,draftId,providerDraftOrderId]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async restoreDraftPreparation(companyId:string,draftId:string){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET state='CHECKOUT_PENDING',updated_at=now()
       WHERE company_id=$1 AND draft_id=$2 AND state='DRAFT_PREPARING' AND provider_draft_order_id IS NULL
       RETURNING *`,
      [companyId,draftId]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async attachPaymentReference(companyId:string,draftId:string,input:{
    reference:string;
    kind:'checkout_session'|'payment_intent';
  }){
    await this.init();
    const checkoutSessionId=input.kind==='checkout_session'?input.reference:null;
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET payment_reference=COALESCE(payment_reference,$3),
           payment_reference_kind=COALESCE(payment_reference_kind,$4),
           checkout_session_id=COALESCE(checkout_session_id,$5),
           state='CHECKOUT_CREATED',
           updated_at=now()
       WHERE company_id=$1 AND draft_id=$2
         AND state IN ('CHECKOUT_PENDING','CHECKOUT_CREATED')
         AND (payment_reference IS NULL OR payment_reference=$3)
         AND (payment_reference_kind IS NULL OR payment_reference_kind=$4)
       RETURNING *`,
      [companyId,draftId,input.reference,input.kind,checkoutSessionId]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async attachCheckout(companyId:string,draftId:string,checkoutSessionId:string){
    return this.attachPaymentReference(companyId,draftId,{reference:checkoutSessionId,kind:'checkout_session'});
  }

  async markPaymentFallbackPending(companyId:string,draftId:string,paymentIntentId:string){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET state='PAYMENT_FALLBACK_PENDING',updated_at=now()
       WHERE company_id=$1 AND draft_id=$2
         AND state IN ('CHECKOUT_CREATED','PAYMENT_FALLBACK_PENDING')
         AND payment_reference=$3
         AND payment_reference_kind='payment_intent'
       RETURNING *`,
      [companyId,draftId,paymentIntentId]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async replacePaymentReference(companyId:string,draftId:string,args:{
    fromReference:string;
    fromKind:'payment_intent';
    toReference:string;
    toKind:'checkout_session';
  }){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET payment_reference=$5,
           payment_reference_kind=$6,
           checkout_session_id=$5,
           state='CHECKOUT_CREATED',
           updated_at=now()
       WHERE company_id=$1 AND draft_id=$2
         AND state IN ('CHECKOUT_CREATED','PAYMENT_FALLBACK_PENDING')
         AND payment_reference=$3
         AND payment_reference_kind=$4
       RETURNING *`,
      [companyId,draftId,args.fromReference,args.fromKind,args.toReference,args.toKind]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async claimPaidPayment(reference:string,kind:'checkout_session'|'payment_intent'){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET state='ORDER_EXECUTING',updated_at=now()
       WHERE state='CHECKOUT_CREATED'
         AND (
           (payment_reference=$1 AND payment_reference_kind=$2)
           OR ($2='checkout_session' AND payment_reference IS NULL AND checkout_session_id=$1)
         )
       RETURNING *`,
      [reference,kind]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async claimPaidCheckout(checkoutSessionId:string){
    return this.claimPaidPayment(checkoutSessionId,'checkout_session');
  }

  async markOrderCreated(companyId:string,draftId:string,providerOrderId:string){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET state='ORDER_CREATED',provider_order_id=$3,updated_at=now()
       WHERE company_id=$1 AND draft_id=$2 AND state='ORDER_EXECUTING'
       RETURNING *`,
      [companyId,draftId,providerOrderId]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async markReconcileRequired(companyId:string,draftId:string){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET state='RECONCILE_REQUIRED',updated_at=now()
       WHERE company_id=$1 AND draft_id=$2 AND state='ORDER_EXECUTING'
       RETURNING *`,
      [companyId,draftId]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }


  async listReconcileRequired(companyId:string,limit=50){
    await this.init();
    const bounded=Math.max(1,Math.min(100,Math.trunc(limit)||50));
    const result=await this.pool.query(
      `SELECT * FROM provider_transaction_intents
       WHERE company_id=$1 AND state='RECONCILE_REQUIRED'
       ORDER BY updated_at ASC
       LIMIT $2`,
      [companyId,bounded]
    );
    return result.rows.map(row);
  }

  async resolveReconciliation(input:{
    companyId:string;
    draftId:string;
    resolution:'CONFIRM_ORDER'|'NO_ORDER';
    providerOrderId?:string;
    note:string;
  }){
    await this.init();
    const note=input.note.trim().slice(0,1000);
    if(!note) throw new Error('provider_reconciliation_note_required');
    if(input.resolution==='CONFIRM_ORDER'){
      const providerOrderId=input.providerOrderId?.trim();
      if(!providerOrderId) throw new Error('provider_reconciliation_order_id_required');
      const result=await this.pool.query(
        `UPDATE provider_transaction_intents
         SET state='ORDER_CREATED',provider_order_id=$3,reconciliation_note=$4,updated_at=now()
         WHERE company_id=$1 AND draft_id=$2 AND state='RECONCILE_REQUIRED'
         RETURNING *`,
        [input.companyId,input.draftId,providerOrderId,note]
      );
      return result.rows[0]?row(result.rows[0]):null;
    }
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET state='REFUND_REQUIRED',reconciliation_note=$3,updated_at=now()
       WHERE company_id=$1 AND draft_id=$2 AND state='RECONCILE_REQUIRED'
       RETURNING *`,
      [input.companyId,input.draftId,note]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }


  async listRefundRequired(companyId:string,limit=50){
    await this.init();
    const bounded=Math.max(1,Math.min(100,Math.trunc(limit)||50));
    const result=await this.pool.query(
      `SELECT * FROM provider_transaction_intents
       WHERE company_id=$1 AND state='REFUND_REQUIRED'
       ORDER BY updated_at ASC
       LIMIT $2`,
      [companyId,bounded]
    );
    return result.rows.map(row);
  }

  async claimRefund(companyId:string,draftId:string){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET state='REFUND_EXECUTING',updated_at=now()
       WHERE company_id=$1 AND draft_id=$2 AND state IN ('REFUND_REQUIRED','REFUND_EXECUTING')
       RETURNING *`,
      [companyId,draftId]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async restoreRefundRequired(companyId:string,draftId:string){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET state='REFUND_REQUIRED',updated_at=now()
       WHERE company_id=$1 AND draft_id=$2 AND state IN ('REFUND_EXECUTING','REFUND_SUBMITTED')
       RETURNING *`,
      [companyId,draftId]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async markRefundSubmitted(companyId:string,draftId:string,refundId:string){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET state='REFUND_SUBMITTED',refund_id=$3,updated_at=now()
       WHERE company_id=$1 AND draft_id=$2 AND state='REFUND_EXECUTING'
       RETURNING *`,
      [companyId,draftId,refundId]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async markRefunded(companyId:string,draftId:string,refundId:string){

    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET state='REFUNDED',refund_id=$3,updated_at=now()
       WHERE company_id=$1 AND draft_id=$2 AND state IN ('REFUND_EXECUTING','REFUND_SUBMITTED')
       RETURNING *`,
      [companyId,draftId,refundId]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }


  async markRefundFailed(companyId:string,draftId:string,refundId:string){
    await this.init();
    const result=await this.pool.query(
      `UPDATE provider_transaction_intents
       SET state='REFUND_REQUIRED',refund_id=$3,updated_at=now()
       WHERE company_id=$1 AND draft_id=$2 AND state IN ('REFUND_EXECUTING','REFUND_SUBMITTED')
       RETURNING *`,
      [companyId,draftId,refundId]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }


  async listStaleRefundSubmitted(olderThan:Date,limit=100){
    await this.init();
    const bounded=Math.max(1,Math.min(500,Math.trunc(limit)||100));
    const result=await this.pool.query(
      `SELECT * FROM provider_transaction_intents
       WHERE state='REFUND_SUBMITTED'
         AND refund_id IS NOT NULL
         AND updated_at <= $1
       ORDER BY updated_at ASC
       LIMIT $2`,
      [olderThan.toISOString(),bounded]
    );
    return result.rows.map(row);
  }

  async getForConsumer(subjectId:string,draftId:string):Promise<ProviderTransactionIntent|null>{
    await this.init();
    const normalizedSubject=subjectId.trim();
    const normalizedDraft=draftId.trim();
    if(!normalizedSubject||!normalizedDraft) return null;
    const result=await this.pool.query(
      'SELECT * FROM provider_transaction_intents WHERE consumer_subject_id=$1 AND draft_id=$2',
      [normalizedSubject,normalizedDraft]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }

  async get(companyId:string,draftId:string):Promise<ProviderTransactionIntent|null>{
    await this.init();
    const result=await this.pool.query(
      'SELECT * FROM provider_transaction_intents WHERE company_id=$1 AND draft_id=$2',
      [companyId,draftId]
    );
    return result.rows[0]?row(result.rows[0]):null;
  }
}

function row(value:any):ProviderTransactionIntent{
  return {
    companyId:String(value.company_id),
    draftId:String(value.draft_id),
    paymentProvider:String(value.payment_provider),
    paymentExternalAccountId:String(value.payment_external_account_id),
    consumerSubjectId:value.consumer_subject_id?String(value.consumer_subject_id):undefined,
    fulfillmentProvider:String(value.fulfillment_provider),
    fulfillmentExternalAccountId:String(value.fulfillment_external_account_id),
    fulfillmentPayload:value.fulfillment_payload&&typeof value.fulfillment_payload==='object'?value.fulfillment_payload:{},
    amount:Number(value.amount),
    currency:String(value.currency),
    checkoutSessionId:value.checkout_session_id?String(value.checkout_session_id):undefined,
    paymentReference:value.payment_reference?String(value.payment_reference):(value.checkout_session_id?String(value.checkout_session_id):undefined),
    paymentReferenceKind:value.payment_reference_kind?String(value.payment_reference_kind) as 'checkout_session'|'payment_intent':(value.checkout_session_id?'checkout_session':undefined),
    providerOrderId:value.provider_order_id?String(value.provider_order_id):undefined,
    providerDraftOrderId:value.provider_draft_order_id?String(value.provider_draft_order_id):undefined,
    approvalJti:value.approval_jti?String(value.approval_jti):undefined,
    reconciliationNote:value.reconciliation_note?String(value.reconciliation_note):undefined,
    refundId:value.refund_id?String(value.refund_id):undefined,
    state:String(value.state) as ProviderTransactionState,
    createdAt:new Date(value.created_at).toISOString(),
    updatedAt:new Date(value.updated_at).toISOString()
  };
}
