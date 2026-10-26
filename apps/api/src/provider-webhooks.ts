import {createHash} from 'node:crypto';
import {Pool} from 'pg';
import {verifyStripeWebhookOnce,fulfillmentMayStart} from '@gift-signal/payments';
import {parseVerifiedWebhookOnce} from '@gift-signal/shopify-webhooks';
import {PostgresZeroTrustAuthority,PostgresTenantProviderCredentialVault,VaultBackedProviderRuntime,PostgresSecurityAuditSink} from '@gift-signal/mcp-gateway';
import {PostgresProviderReadinessEvidenceStore} from './provider-readiness-store.js';
import {PostgresProviderTransactionIntentStore} from './provider-transaction-store.js';
import {PostgresProviderConnectionStore} from './provider-connections.js';
import {ProviderRuntimeControlPlane} from './provider-runtime-control.js';
import {ProviderSecurityAuditor} from './provider-security-audit.js';

let pool:Pool|null=null;
let authority:PostgresZeroTrustAuthority|null=null;
let initialized=false;
let readinessEvidence:PostgresProviderReadinessEvidenceStore|null=null;
let transactionIntents:PostgresProviderTransactionIntentStore|null=null;
let orderControl:ProviderRuntimeControlPlane|null=null;
let webhookAuditor:ProviderSecurityAuditor|null=null;

function db(){
  if(!process.env.DATABASE_URL) throw new Error('database_not_configured');
  pool??=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined});
  return pool;
}

async function init(){
  if(initialized) return;
  await db().query(
    'CREATE TABLE IF NOT EXISTS provider_webhook_events (provider TEXT NOT NULL, event_id TEXT NOT NULL, event_type TEXT NOT NULL, body_sha256 TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now(), accepted BOOLEAN NOT NULL, PRIMARY KEY(provider,event_id)); CREATE INDEX IF NOT EXISTS idx_provider_webhook_events_received ON provider_webhook_events(received_at DESC);'
  );
  authority??=PostgresZeroTrustAuthority.fromUrl(process.env.DATABASE_URL!);
  transactionIntents??=new PostgresProviderTransactionIntentStore(db());
  if(!orderControl){
    const vault=new PostgresTenantProviderCredentialVault(db());
    const runtime=new VaultBackedProviderRuntime(vault);
    const connections=new PostgresProviderConnectionStore(db());
    const auditSink=process.env.AUDIT_SIGNING_SECRET?new PostgresSecurityAuditSink(db(),process.env.AUDIT_SIGNING_SECRET):undefined;
    const auditor=auditSink?new ProviderSecurityAuditor(auditSink):undefined;
    webhookAuditor=auditor??null;
    orderControl=new ProviderRuntimeControlPlane(runtime,connections,auditor);
  }
  initialized=true;
}

export async function promoteVerifiedShopifyWebhookEvidence(
  shopDomain:string,
  options:{
    topic?:string;
    pool?:{query(sql:string,params?:unknown[]):Promise<{rows:any[]}>};
    evidence?:{markTrusted(key:{companyId:string;provider:string;externalAccountId:string},patch:{webhookEvents?:boolean;idempotency?:boolean;fulfillmentStatus?:boolean}):Promise<unknown>};
  }={}
){
  const database=options.pool??db();
  const result=await database.query(
    `SELECT company_id,external_account_id,granted_capabilities
     FROM provider_connections
     WHERE provider='shopify' AND lower(external_account_id)=lower($1) AND revoked_at IS NULL
     LIMIT 2`,
    [shopDomain]
  );
  if(result.rows.length!==1) return {promoted:false,reason:result.rows.length===0?'connection_not_found':'connection_ambiguous'} as const;
  const row=result.rows[0];
  const evidence=options.evidence??(readinessEvidence??=new PostgresProviderReadinessEvidenceStore(db()));
  const capabilities=Array.isArray(row.granted_capabilities)?row.granted_capabilities:[];
  const fulfillmentTopic=options.topic==='fulfillments/create'||options.topic==='fulfillments/update';
  const fulfillmentStatus=fulfillmentTopic&&capabilities.includes('fulfillment.read');
  await evidence.markTrusted(
    {companyId:String(row.company_id),provider:'shopify',externalAccountId:String(row.external_account_id)},
    {webhookEvents:true,idempotency:true,...(fulfillmentStatus?{fulfillmentStatus:true}:{})}
  );
  return {
    promoted:true,
    companyId:String(row.company_id),
    externalAccountId:String(row.external_account_id),
    ...(fulfillmentStatus?{fulfillmentStatus:true}:{})
  } as const;
}

async function record(provider:string,eventId:string,eventType:string,rawBody:Buffer,accepted:boolean){
  await init();
  await db().query(
    'INSERT INTO provider_webhook_events (provider,event_id,event_type,body_sha256,accepted) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (provider,event_id) DO NOTHING',
    [provider,eventId,eventType,createHash('sha256').update(rawBody).digest('hex'),accepted]
  );
}

export async function handleStripeWebhook(rawBody:Buffer,signatureHeader:string|undefined){
  await init();
  const secret=process.env.STRIPE_WEBHOOK_SECRET;
  if(!secret) throw new Error('stripe_webhook_not_configured');
  const verified=await verifyStripeWebhookOnce({rawBody,signatureHeader,webhookSecret:secret,replay:authority!});
  if(!verified.ok) throw new Error(verified.reason);
  let event:{id:string;type:string;data?:{object?:{id?:string;payment_status?:string;status?:string;metadata?:Record<string,string>}}};
  try{event=JSON.parse(rawBody.toString('utf8'));}catch{throw new Error('invalid_webhook_json');}
  const canFulfill=fulfillmentMayStart(event);
  await record('stripe',verified.eventId,verified.type,rawBody,true);

  if(event.type==='refund.created'||event.type==='refund.updated'||event.type==='refund.failed'){
    const refundState=await applyStripeRefundEvent({
      eventType:event.type,
      refund:event.data?.object,
      intents:transactionIntents!,
      auditor:webhookAuditor??undefined
    });
    return {accepted:true,eventId:verified.eventId,type:verified.type,refundState};
  }
  if(!canFulfill) return {accepted:true,eventId:verified.eventId,type:verified.type,fulfillmentMayStart:false};
  const paymentReference=event.data?.object?.id;
  if(!paymentReference) return {accepted:true,eventId:verified.eventId,type:verified.type,fulfillmentMayStart:true,fulfillmentState:'INTENT_NOT_FOUND'};
  const paymentReferenceKind=event.type==='payment_intent.succeeded'?'payment_intent':'checkout_session';
  const fulfillment=await applyPaidPaymentFulfillment({
    paymentReference,
    paymentReferenceKind,
    intents:transactionIntents!,
    orderControl:orderControl!
  });
  return {accepted:true,eventId:verified.eventId,type:verified.type,fulfillmentMayStart:true,...fulfillment};
}


export async function applyPaidPaymentFulfillment(args:{
  paymentReference:string;
  paymentReferenceKind:'checkout_session'|'payment_intent';
  intents:Pick<PostgresProviderTransactionIntentStore,'claimPaidPayment'|'markOrderCreated'|'markReconcileRequired'>;
  orderControl:Pick<ProviderRuntimeControlPlane,'completeDraftOrder'|'createOrder'>;
}){
  const intent=await args.intents.claimPaidPayment(args.paymentReference,args.paymentReferenceKind);
  if(!intent) return {fulfillmentState:'ALREADY_CLAIMED_OR_NOT_FOUND' as const};
  try{
    const payload=intent.fulfillmentPayload;
    let providerOrderId:string;
    if(intent.providerDraftOrderId){
      const completed=await args.orderControl.completeDraftOrder(
        {companyId:intent.companyId,provider:intent.fulfillmentProvider,externalAccountId:intent.fulfillmentExternalAccountId},
        {draftOrderId:intent.providerDraftOrderId}
      );
      providerOrderId=completed.result.providerOrderId;
    }else{
      const lineItems=Array.isArray(payload.lineItems)?payload.lineItems as Array<{variantId:string;quantity:number}>:[];
      const created=await args.orderControl.createOrder(
        {companyId:intent.companyId,provider:intent.fulfillmentProvider,externalAccountId:intent.fulfillmentExternalAccountId},
        {draftId:intent.draftId,lineItems}
      );
      providerOrderId=created.result.providerOrderId;
    }
    await args.intents.markOrderCreated(intent.companyId,intent.draftId,providerOrderId);
    return {fulfillmentState:'ORDER_CREATED' as const,providerOrderId};
  }catch{
    await args.intents.markReconcileRequired(intent.companyId,intent.draftId);
    return {fulfillmentState:'RECONCILE_REQUIRED' as const};
  }
}


export async function applyStripeRefundEvent(args:{
  eventType:string;
  refund?:{id?:string;status?:string;metadata?:Record<string,string>};
  intents:Pick<PostgresProviderTransactionIntentStore,'markRefunded'|'markRefundFailed'>;
  auditor?:ProviderSecurityAuditor;
}){
  const refundId=args.refund?.id;
  const companyId=args.refund?.metadata?.company_id;
  const draftId=args.refund?.metadata?.draft_id;
  if(!refundId||!companyId||!draftId) return 'UNMATCHED' as const;

  if(args.eventType==='refund.failed'||args.refund?.status==='failed'||args.refund?.status==='canceled'){
    const transaction=await args.intents.markRefundFailed(companyId,draftId,refundId);
    if(transaction){
      await args.auditor?.record('provider.transaction.refund_failed',{
        companyId,
        provider:transaction.paymentProvider,
        externalAccountId:transaction.paymentExternalAccountId,
        draftId,
        amount:transaction.amount,
        currency:transaction.currency
      });
    }
    return transaction?'REFUND_REQUIRED' as const:'IGNORED' as const;
  }

  if(args.refund?.status==='succeeded'){
    const transaction=await args.intents.markRefunded(companyId,draftId,refundId);
    if(transaction){
      await args.auditor?.record('provider.transaction.refunded',{
        companyId,
        provider:transaction.paymentProvider,
        externalAccountId:transaction.paymentExternalAccountId,
        draftId,
        amount:transaction.amount,
        currency:transaction.currency
      });
    }
    return transaction?'REFUNDED' as const:'IGNORED' as const;
  }

  return 'REFUND_SUBMITTED' as const;
}

export async function handleShopifyWebhook(rawBody:Buffer,headers:Record<string,string|undefined>){
  await init();
  const secret=process.env.SHOPIFY_WEBHOOK_SECRET;
  if(!secret) throw new Error('shopify_webhook_not_configured');
  const parsed=await parseVerifiedWebhookOnce({rawBody,headers,secret,replay:authority!});
  await record('shopify',parsed.webhookId,parsed.topic,rawBody,true);
  const readiness=await promoteVerifiedShopifyWebhookEvidence(parsed.shopDomain,{topic:parsed.topic});
  return {accepted:true,eventId:parsed.webhookId,type:parsed.topic,shopDomain:parsed.shopDomain,readiness};
}

export async function closeProviderWebhookState(){
  await authority?.close();
  await pool?.end();
  authority=null;
  pool=null;
  readinessEvidence=null;
  transactionIntents=null;
  orderControl=null;
  webhookAuditor=null;
  initialized=false;
}


export async function applyPaidCheckoutFulfillment(args:{
  checkoutSessionId:string;
  intents:Pick<PostgresProviderTransactionIntentStore,'claimPaidCheckout'|'markOrderCreated'|'markReconcileRequired'>;
  orderControl:Pick<ProviderRuntimeControlPlane,'completeDraftOrder'|'createOrder'>;
}){
  return applyPaidPaymentFulfillment({
    paymentReference:args.checkoutSessionId,
    paymentReferenceKind:'checkout_session',
    intents:{
      claimPaidPayment:(reference:string)=>args.intents.claimPaidCheckout(reference),
      markOrderCreated:args.intents.markOrderCreated.bind(args.intents),
      markReconcileRequired:args.intents.markReconcileRequired.bind(args.intents)
    } as any,
    orderControl:args.orderControl
  });
}
