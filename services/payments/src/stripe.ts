import {createHmac,timingSafeEqual} from 'node:crypto';
import {consumeWebhookOnce,type ReplayStore} from '@gift-signal/zero-trust';

export interface StripeCheckoutDraft {
  draftId:string;
  companyId:string;
  amountCents:number;
  currency:string;
  description:string;
  successUrl:string;
  cancelUrl:string;
  customerEmail?:string;
}

export interface StripeCheckoutResult {
  checkoutSessionId:string;
  checkoutUrl:string;
  status:string;
  paymentRail:'stripe';
  handoff:{required:true;kind:'payment_rail';provider:'stripe'};
}

export function assertTrustedStripeCheckoutUrl(value:string){
  let url:URL;
  try{url=new URL(value);}catch{throw new Error('stripe_checkout_url_invalid');}
  if(url.origin!=='https://checkout.stripe.com'||url.username||url.password){
    throw new Error('stripe_checkout_url_untrusted');
  }
  return url.toString();
}

/** Read the existing session only. This never creates, confirms or retries payment. */
export async function readStripeTransactionCheckout(args:{
  checkoutSessionId:string;companyId:string;draftId:string;amount:number;currency:string;
  secretKey:string;fetchImpl?:typeof fetch;
}):Promise<{status:'open'|'complete'|'expired';checkoutUrl?:string}>{
  if(!args.secretKey) throw Error('stripe_secret_required');
  if(!/^cs_[A-Za-z0-9_]+$/.test(args.checkoutSessionId)) throw Error('stripe_checkout_session_invalid');
  const response=await (args.fetchImpl??fetch)('https://api.stripe.com/v1/checkout/sessions/'+encodeURIComponent(args.checkoutSessionId),{
    headers:{authorization:`Bearer ${args.secretKey}`},signal:AbortSignal.timeout(5000)
  });
  if(!response.ok) throw Error(`stripe_checkout_lookup_failed:${response.status}`);
  const value=await response.json() as {id?:string;mode?:string;status?:string;payment_status?:string;amount_total?:number;currency?:string;url?:string;metadata?:Record<string,string>};
  if(value.id!==args.checkoutSessionId||value.mode!=='payment'||value.metadata?.company_id!==args.companyId||value.metadata?.draft_id!==args.draftId||
    value.amount_total!==currencyAmountToMinorUnits(args.amount,args.currency)||value.currency?.toUpperCase()!==args.currency.toUpperCase()) throw Error('stripe_checkout_transaction_mismatch');
  if(value.status==='complete'||value.status==='expired') return {status:value.status};
  if(value.status!=='open'||value.payment_status!=='unpaid') throw Error('stripe_checkout_state_invalid');
  return {status:'open',checkoutUrl:assertTrustedStripeCheckoutUrl(value.url??'')};
}

export function currencyAmountToMinorUnits(amount:number,currency:string){
  if(!Number.isFinite(amount)||amount<=0) throw new Error('invalid_amount');
  const digits:number=new Intl.NumberFormat('en-US',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2;
  if(!Number.isInteger(digits)||digits<0||digits>4) throw new Error('invalid_currency_precision');
  const fixed=amount.toFixed(digits);
  const [major,fraction='']=fixed.split('.');
  const minor=BigInt(major)*10n**BigInt(digits)+BigInt((fraction+'0'.repeat(digits)).slice(0,digits)||'0');
  if(minor<=0n||minor>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('invalid_amount_cents');
  return Number(minor);
}

export async function createStripeCheckout(
  draft:StripeCheckoutDraft,
  secretKey:string,
  fetchImpl:typeof fetch=fetch
):Promise<StripeCheckoutResult>{
  if(!secretKey) throw new Error('stripe_secret_required');
  if(!Number.isInteger(draft.amountCents)||draft.amountCents<=0) throw new Error('invalid_amount_cents');
  if(!/^[a-z]{3}$/i.test(draft.currency)) throw new Error('invalid_currency');

  const body=new URLSearchParams({
    mode:'payment',
    success_url:draft.successUrl,
    cancel_url:draft.cancelUrl,
    'line_items[0][price_data][currency]':draft.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]':String(draft.amountCents),
    'line_items[0][price_data][product_data][name]':draft.description,
    'line_items[0][quantity]':'1',
    'metadata[draft_id]':draft.draftId,
    'metadata[company_id]':draft.companyId
  });
  if(draft.customerEmail) body.set('customer_email',draft.customerEmail);

  const response=await fetchImpl('https://api.stripe.com/v1/checkout/sessions',{
    method:'POST',
    headers:{
      authorization:`Bearer ${secretKey}`,
      'content-type':'application/x-www-form-urlencoded',
      'idempotency-key':`gift-signal:${draft.companyId}:${draft.draftId}`
    },
    body
  });
  if(!response.ok) throw new Error(`stripe_checkout_failed:${response.status}`);
  const payload=await response.json() as {id?:string;url?:string;status?:string};
  if(!payload.id||!payload.url) throw new Error('stripe_checkout_missing_fields');
  const checkoutUrl=assertTrustedStripeCheckoutUrl(payload.url);
  return {checkoutSessionId:payload.id,checkoutUrl,status:payload.status??'open',paymentRail:'stripe',handoff:{required:true,kind:'payment_rail',provider:'stripe'}};
}


export interface StripeRefundResult {
  refundId:string;
  status:string;
  paymentIntentId:string;
}

export async function refundStripeCheckout(args:{
  checkoutSessionId:string;
  companyId:string;
  draftId:string;
  secretKey:string;
  fetchImpl?:typeof fetch;
}):Promise<StripeRefundResult>{
  if(!args.secretKey) throw new Error('stripe_secret_required');
  if(!/^cs_[A-Za-z0-9_]+$/.test(args.checkoutSessionId)) throw new Error('stripe_checkout_session_invalid');
  const fetchImpl=args.fetchImpl??fetch;
  const sessionResponse=await fetchImpl(
    'https://api.stripe.com/v1/checkout/sessions/'+encodeURIComponent(args.checkoutSessionId),
    {headers:{authorization:`Bearer ${args.secretKey}`}}
  );
  if(!sessionResponse.ok) throw new Error(`stripe_checkout_lookup_failed:${sessionResponse.status}`);
  const session=await sessionResponse.json() as {payment_intent?:string|null;payment_status?:string};
  if(session.payment_status!=='paid') throw new Error('stripe_checkout_not_paid');
  if(!session.payment_intent||typeof session.payment_intent!=='string') throw new Error('stripe_payment_intent_missing');

  const body=new URLSearchParams({
    payment_intent:session.payment_intent,
    'metadata[company_id]':args.companyId,
    'metadata[draft_id]':args.draftId
  });
  const refundResponse=await fetchImpl('https://api.stripe.com/v1/refunds',{
    method:'POST',
    headers:{
      authorization:`Bearer ${args.secretKey}`,
      'content-type':'application/x-www-form-urlencoded',
      'idempotency-key':`gift-signal:refund:${args.companyId}:${args.draftId}`
    },
    body
  });
  if(!refundResponse.ok) throw new Error(`stripe_refund_failed:${refundResponse.status}`);
  const refund=await refundResponse.json() as {id?:string;status?:string};
  if(!refund.id) throw new Error('stripe_refund_missing_id');
  return {refundId:refund.id,status:refund.status??'pending',paymentIntentId:session.payment_intent};
}


export async function getStripeRefund(args:{
  refundId:string;
  secretKey:string;
  fetchImpl?:typeof fetch;
}):Promise<{refundId:string;status:string;metadata:Record<string,string>}>{
  if(!args.secretKey) throw new Error('stripe_secret_required');
  if(!/^re_[A-Za-z0-9_]+$/.test(args.refundId)) throw new Error('stripe_refund_id_invalid');
  const fetchImpl=args.fetchImpl??fetch;
  const response=await fetchImpl(
    'https://api.stripe.com/v1/refunds/'+encodeURIComponent(args.refundId),
    {headers:{authorization:`Bearer ${args.secretKey}`}}
  );
  if(!response.ok) throw new Error(`stripe_refund_lookup_failed:${response.status}`);
  const refund=await response.json() as {id?:string;status?:string;metadata?:Record<string,string>};
  if(!refund.id||!refund.status) throw new Error('stripe_refund_lookup_missing_fields');
  return {refundId:refund.id,status:refund.status,metadata:refund.metadata??{}};
}

export function verifyStripeWebhook(args:{
  rawBody:Buffer;
  signatureHeader:string|undefined;
  webhookSecret:string;
  nowSeconds?:number;
  toleranceSeconds?:number;
}){
  if(!args.signatureHeader||!args.webhookSecret) return {ok:false,reason:'missing_signature'} as const;
  const parts=args.signatureHeader.split(',').map(part=>part.trim());
  const timestamp=parts.find(part=>part.startsWith('t='))?.slice(2);
  const signatures=parts.filter(part=>part.startsWith('v1=')).map(part=>part.slice(3));
  if(!timestamp||!signatures.length) return {ok:false,reason:'malformed_signature'} as const;
  const ts=Number(timestamp);
  if(!Number.isFinite(ts)) return {ok:false,reason:'invalid_timestamp'} as const;
  const now=args.nowSeconds??Math.floor(Date.now()/1000);
  const tolerance=args.toleranceSeconds??300;
  if(Math.abs(now-ts)>tolerance) return {ok:false,reason:'signature_too_old'} as const;

  const expected=createHmac('sha256',args.webhookSecret)
    .update(`${timestamp}.`)
    .update(args.rawBody)
    .digest('hex');
  const expectedBuffer=Buffer.from(expected);
  const valid=signatures.some(signature=>{
    const candidate=Buffer.from(signature);
    return candidate.length===expectedBuffer.length&&timingSafeEqual(candidate,expectedBuffer);
  });
  return valid?{ok:true,timestamp:ts} as const:{ok:false,reason:'bad_signature'} as const;
}

export function fulfillmentMayStart(event:{type:string;data?:{object?:{payment_status?:string;status?:string}}}){
  if(event.type==='checkout.session.completed') return event.data?.object?.payment_status==='paid';
  if(event.type==='payment_intent.succeeded') return event.data?.object?.status==='succeeded';
  return false;
}

export async function verifyStripeWebhookOnce(args:{
  rawBody:Buffer;
  signatureHeader:string|undefined;
  webhookSecret:string;
  replay:ReplayStore;
  nowSeconds?:number;
}){
  const verified=verifyStripeWebhook({rawBody:args.rawBody,signatureHeader:args.signatureHeader,webhookSecret:args.webhookSecret,nowSeconds:args.nowSeconds});
  if(!verified.ok) return verified;
  let payload:{id?:string;type?:string};
  try{payload=JSON.parse(args.rawBody.toString('utf8'));}catch{return {ok:false,reason:'invalid_webhook_json'} as const;}
  if(!payload.id) return {ok:false,reason:'missing_webhook_id'} as const;
  const nowMs=(args.nowSeconds??Math.floor(Date.now()/1000))*1000;
  const expiresAt=new Date(nowMs+24*60*60*1000).toISOString();
  if(!await consumeWebhookOnce({provider:'stripe',eventId:payload.id,expiresAt,replay:args.replay})) return {ok:false,reason:'webhook_replayed'} as const;
  return {ok:true,timestamp:verified.timestamp,eventId:payload.id,type:payload.type??'unknown'} as const;
}


export interface StripeDirectPaymentDraft {
  draftId:string;
  companyId:string;
  amountCents:number;
  currency:string;
  description:string;
  customerId:string;
  paymentMethodId:string;
  receiptEmail?:string;
}

export interface StripeDirectPaymentResult {
  paymentIntentId:string;
  status:'succeeded'|'processing';
  paymentRail:'stripe';
  handoff:{required:false;kind:'none';provider:'stripe'};
}

export async function createStripeDirectPayment(
  draft:StripeDirectPaymentDraft,
  secretKey:string,
  fetchImpl:typeof fetch=fetch
):Promise<StripeDirectPaymentResult>{
  if(!secretKey) throw new Error('stripe_secret_required');
  if(!Number.isInteger(draft.amountCents)||draft.amountCents<=0) throw new Error('invalid_amount_cents');
  if(!/^[a-z]{3}$/i.test(draft.currency)) throw new Error('invalid_currency');
  if(!/^cus_[A-Za-z0-9_]+$/.test(draft.customerId)) throw new Error('stripe_customer_id_invalid');
  if(!/^pm_[A-Za-z0-9_]+$/.test(draft.paymentMethodId)) throw new Error('stripe_payment_method_id_invalid');

  const body=new URLSearchParams({
    amount:String(draft.amountCents),
    currency:draft.currency.toLowerCase(),
    customer:draft.customerId,
    payment_method:draft.paymentMethodId,
    off_session:'true',
    confirm:'true',
    error_on_requires_action:'true',
    description:draft.description,
    'metadata[draft_id]':draft.draftId,
    'metadata[company_id]':draft.companyId
  });
  if(draft.receiptEmail) body.set('receipt_email',draft.receiptEmail);

  const response=await fetchImpl('https://api.stripe.com/v1/payment_intents',{
    method:'POST',
    headers:{
      authorization:`Bearer ${secretKey}`,
      'content-type':'application/x-www-form-urlencoded',
      'idempotency-key':`gift-signal:direct:${draft.companyId}:${draft.draftId}`
    },
    body
  });
  const payload=await response.json() as {id?:string;status?:string;error?:{code?:string}};
  if(!response.ok){
    if(payload.error?.code==='authentication_required') throw new Error('stripe_payment_requires_action');
    throw new Error(`stripe_direct_payment_failed:${response.status}`);
  }
  if(!payload.id||!/^pi_[A-Za-z0-9_]+$/.test(payload.id)) throw new Error('stripe_payment_intent_missing');
  if(payload.status!=='succeeded'&&payload.status!=='processing') throw new Error('stripe_direct_payment_not_complete');
  return {
    paymentIntentId:payload.id,
    status:payload.status,
    paymentRail:'stripe',
    handoff:{required:false,kind:'none',provider:'stripe'}
  };
}


export interface StripePreparedDirectPayment {
  paymentIntentId:string;
  status:string;
}

export async function prepareStripeDirectPayment(
  draft:StripeDirectPaymentDraft,
  secretKey:string,
  fetchImpl:typeof fetch=fetch
):Promise<StripePreparedDirectPayment>{
  if(!secretKey) throw new Error('stripe_secret_required');
  if(!Number.isInteger(draft.amountCents)||draft.amountCents<=0) throw new Error('invalid_amount_cents');
  if(!/^[a-z]{3}$/i.test(draft.currency)) throw new Error('invalid_currency');
  if(!/^cus_[A-Za-z0-9_]+$/.test(draft.customerId)) throw new Error('stripe_customer_id_invalid');
  if(!/^pm_[A-Za-z0-9_]+$/.test(draft.paymentMethodId)) throw new Error('stripe_payment_method_id_invalid');
  const body=new URLSearchParams({
    amount:String(draft.amountCents),
    currency:draft.currency.toLowerCase(),
    customer:draft.customerId,
    payment_method:draft.paymentMethodId,
    description:draft.description,
    'metadata[draft_id]':draft.draftId,
    'metadata[company_id]':draft.companyId
  });
  if(draft.receiptEmail) body.set('receipt_email',draft.receiptEmail);
  const response=await fetchImpl('https://api.stripe.com/v1/payment_intents',{
    method:'POST',
    headers:{
      authorization:`Bearer ${secretKey}`,
      'content-type':'application/x-www-form-urlencoded',
      'idempotency-key':`gift-signal:direct:prepare:${draft.companyId}:${draft.draftId}`
    },
    body
  });
  if(!response.ok) throw new Error(`stripe_direct_payment_prepare_failed:${response.status}`);
  const payload=await response.json() as {id?:string;status?:string};
  if(!payload.id||!/^pi_[A-Za-z0-9_]+$/.test(payload.id)) throw new Error('stripe_payment_intent_missing');
  return {paymentIntentId:payload.id,status:payload.status??'requires_confirmation'};
}

export async function confirmStripeDirectPayment(args:{
  paymentIntentId:string;
  companyId:string;
  draftId:string;
  secretKey:string;
  fetchImpl?:typeof fetch;
}):Promise<StripeDirectPaymentResult>{
  if(!args.secretKey) throw new Error('stripe_secret_required');
  if(!/^pi_[A-Za-z0-9_]+$/.test(args.paymentIntentId)) throw new Error('stripe_payment_intent_invalid');
  const body=new URLSearchParams({
    off_session:'true',
    error_on_requires_action:'true'
  });
  const response=await (args.fetchImpl??fetch)(
    `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(args.paymentIntentId)}/confirm`,
    {
      method:'POST',
      headers:{
        authorization:`Bearer ${args.secretKey}`,
        'content-type':'application/x-www-form-urlencoded',
        'idempotency-key':`gift-signal:direct:confirm:${args.companyId}:${args.draftId}`
      },
      body
    }
  );
  const payload=await response.json() as {id?:string;status?:string;error?:{code?:string}};
  if(!response.ok){
    if(payload.error?.code==='authentication_required') throw new Error('stripe_payment_requires_action');
    throw new Error(`stripe_direct_payment_confirm_failed:${response.status}`);
  }
  if(payload.id!==args.paymentIntentId) throw new Error('stripe_payment_intent_mismatch');
  if(payload.status!=='succeeded'&&payload.status!=='processing') throw new Error('stripe_direct_payment_not_complete');
  return {
    paymentIntentId:args.paymentIntentId,
    status:payload.status,
    paymentRail:'stripe',
    handoff:{required:false,kind:'none',provider:'stripe'}
  };
}


export async function cancelStripePaymentIntent(args:{
  paymentIntentId:string;
  companyId:string;
  draftId:string;
  secretKey:string;
  fetchImpl?:typeof fetch;
}):Promise<{paymentIntentId:string;status:string}>{
  if(!args.secretKey) throw new Error('stripe_secret_required');
  if(!/^pi_[A-Za-z0-9_]+$/.test(args.paymentIntentId)) throw new Error('stripe_payment_intent_invalid');
  const response=await (args.fetchImpl??fetch)(
    `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(args.paymentIntentId)}/cancel`,
    {
      method:'POST',
      headers:{
        authorization:`Bearer ${args.secretKey}`,
        'content-type':'application/x-www-form-urlencoded',
        'idempotency-key':`gift-signal:direct:cancel:${args.companyId}:${args.draftId}`
      }
    }
  );
  if(!response.ok) throw new Error(`stripe_payment_intent_cancel_failed:${response.status}`);
  const payload=await response.json() as {id?:string;status?:string};
  if(payload.id!==args.paymentIntentId) throw new Error('stripe_payment_intent_mismatch');
  if(payload.status!=='canceled') throw new Error('stripe_payment_intent_cancel_unconfirmed');
  return {paymentIntentId:args.paymentIntentId,status:'canceled'};
}


export interface StripeVerifiedSetupAuthorization {
  setupIntentId:string;
  customerId:string;
  paymentMethodId:string;
  usage:'off_session';
}

/** Server-owned enrollment: no customer or payment identifiers come from a browser. */
export async function createStripeEnrollmentSetup(args:{
  enrollmentId:string;
  secretKey:string;
  fetchImpl?:typeof fetch;
}):Promise<{customerId:string;setupIntentId:string;clientSecret:string}>{
  if(!args.secretKey) throw new Error('stripe_secret_required');
  const request=async(path:string,body:URLSearchParams,key:string)=>{
    const response=await (args.fetchImpl??fetch)('https://api.stripe.com/v1/'+path,{
      method:'POST',headers:{authorization:`Bearer ${args.secretKey}`,
        'content-type':'application/x-www-form-urlencoded',
        'idempotency-key':`gift-signal:enrollment:${args.enrollmentId}:${key}`},body
    });
    if(!response.ok) throw new Error(`stripe_enrollment_${key}_failed:${response.status}`);
    return await response.json() as {id?:string;client_secret?:string;customer?:string;usage?:string};
  };
  const customer=await request('customers',new URLSearchParams({'metadata[enrollment_id]':args.enrollmentId}),'customer');
  if(!customer.id||!/^cus_[A-Za-z0-9_]+$/.test(customer.id)) throw new Error('stripe_customer_id_invalid');
  const setup=await request('setup_intents',new URLSearchParams({customer:customer.id,usage:'off_session',
    'automatic_payment_methods[enabled]':'true','metadata[enrollment_id]':args.enrollmentId}),'setup');
  if(!setup.id||!/^seti_[A-Za-z0-9_]+$/.test(setup.id)||!setup.client_secret||setup.customer!==customer.id||setup.usage!=='off_session'){
    throw new Error('stripe_enrollment_setup_mismatch');
  }
  return {customerId:customer.id,setupIntentId:setup.id,clientSecret:setup.client_secret};
}

export async function verifyStripeSetupIntent(args:{
  setupIntentId:string;
  secretKey:string;
  fetchImpl?:typeof fetch;
}):Promise<StripeVerifiedSetupAuthorization>{
  if(!args.secretKey) throw new Error('stripe_secret_required');
  if(!/^seti_[A-Za-z0-9_]+$/.test(args.setupIntentId)) throw new Error('stripe_setup_intent_invalid');
  const response=await (args.fetchImpl??fetch)(
    'https://api.stripe.com/v1/setup_intents/'+encodeURIComponent(args.setupIntentId),
    {headers:{authorization:`Bearer ${args.secretKey}`}}
  );
  if(!response.ok) throw new Error(`stripe_setup_intent_lookup_failed:${response.status}`);
  const payload=await response.json() as {
    id?:string;
    status?:string;
    usage?:string;
    customer?:string|null;
    payment_method?:string|null;
  };
  if(payload.id!==args.setupIntentId) throw new Error('stripe_setup_intent_mismatch');
  if(payload.status!=='succeeded') throw new Error('stripe_setup_intent_not_succeeded');
  if(payload.usage!=='off_session') throw new Error('stripe_setup_intent_usage_invalid');
  if(!payload.customer||!/^cus_[A-Za-z0-9_]+$/.test(payload.customer)) throw new Error('stripe_customer_id_invalid');
  if(!payload.payment_method||!/^pm_[A-Za-z0-9_]+$/.test(payload.payment_method)) throw new Error('stripe_payment_method_id_invalid');
  return {
    setupIntentId:args.setupIntentId,
    customerId:payload.customer,
    paymentMethodId:payload.payment_method,
    usage:'off_session'
  };
}

