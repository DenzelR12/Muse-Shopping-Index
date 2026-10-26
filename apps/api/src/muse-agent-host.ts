import {verifyApproval} from '@gift-signal/zero-trust';
import {assertTrustedStripeCheckoutUrl} from '@gift-signal/payments';
import {validateMuseCommerceStep,type MuseCommerceContext,type MuseCommerceStep} from '@gift-signal/competition-demo/muse-commerce';
import type {MuseToolAgentHost,MusePublicToolStatus} from '@gift-signal/competition-demo/muse-tool-agent';
import type {PostgresZeroTrustAuthority} from '@gift-signal/mcp-gateway';
import type {ProviderTransactionDraftService} from './provider-transaction-draft.js';
import {validateSellerDisplayName,validateItemTitle} from './muse-seller-display.js';
import type {PostgresConsumerCommerceIdentityStore} from './consumer-commerce-identity.js';
import type {PostgresProviderTransactionIntentStore,ProviderTransactionIntent} from './provider-transaction-store.js';

export interface MuseAgentRequest {connectionId:string;draftId:string;message:string;approvalToken?:string}
export function parseMuseAgentRequest(value:unknown):MuseAgentRequest{
  if(!value||typeof value!=='object'||Array.isArray(value)) throw Error('invalid_muse_agent_request');
  const body=value as Record<string,unknown>;
  if(Object.keys(body).some(key=>!['connectionId','draftId','message','approvalToken'].includes(key))) throw Error('invalid_muse_agent_request');
  for(const key of ['connectionId','draftId','message']){
    if(typeof body[key]!=='string'||!body[key].trim()||body[key].length>(key==='message'?4000:160)) throw Error('invalid_muse_agent_request');
  }
  if(body.approvalToken!==undefined&&(typeof body.approvalToken!=='string'||!body.approvalToken||body.approvalToken.length>8192)) throw Error('invalid_muse_agent_request');
  return {connectionId:body.connectionId as string,draftId:body.draftId as string,message:body.message as string,
    ...(body.approvalToken?{approvalToken:body.approvalToken as string}:{})};
}

export type MuseExecutionProfile='reference'|'generic';
export interface MuseGenericExecutionResult{status:'CONFIRMED'|'DECLINED'|'FAILED'|'UNCERTAIN';executionId?:string;providerReference?:string;message?:string}

export interface MuseHostDependencies {
  authority:Pick<PostgresZeroTrustAuthority,'resolve'>;
  drafts:Pick<ProviderTransactionDraftService,'verifyForExecution'>;
  identities:Pick<PostgresConsumerCommerceIdentityStore,'resolveStripeSavedPayment'>;
  transactions:Pick<PostgresProviderTransactionIntentStore,'getForConsumer'|'get'>;
  businessReady:(companyId:string,shopDomain:string)=>Promise<boolean>;
  resolveSellerDisplayName?:(companyId:string)=>Promise<string|null>;
  submit:(args:{subjectId:string;consumerEmail?:string;connectionId:string;draftId:string;approvalToken:string})=>Promise<{
    handoff:{required:boolean};checkoutUrl?:string;
  }>;
  // Generic execution profile (rail-independent companies). All four are
  // optional: when resolveExecutionProfile is absent the host keeps the
  // existing reference (Stripe/Shopify) path unchanged.
  resolveExecutionProfile?:(args:{companyId:string;connectionId:string;draftId:string})=>Promise<MuseExecutionProfile>;
  // Per-company readiness gate for the generic path only. Absent means
  // unverified, which fails closed; it never falls back to the reference
  // businessReady check, which is Shopify-specific.
  genericReadiness?:(companyId:string)=>Promise<boolean>;
  // Rail-independent executor, normally ZeroTrustConnectorRuntime.execute.
  // It owns exact approval verification/consumption, drift revalidation,
  // and the single execution claim; the host never retries it.
  submitGeneric?:(args:{subjectId:string;consumerEmail?:string;companyId:string;connectionId:string;draftId:string;approvalToken:string})=>Promise<MuseGenericExecutionResult>;
  // Signed generic draft facts for readContext only. Dispatch of a generic
  // execute never uses the reference draft service, whose state parser is
  // Stripe/Shopify-shaped and would reject a generic draft.
  genericDraft?:(args:{companyId:string;connectionId:string;draftId:string})=>Promise<{draftHash:string;total:number;currency:string;expiresAt:string}|null>;
  readTracking?:(transaction:ProviderTransactionIntent)=>Promise<Array<{company?:string;number?:string;url?:string}>>;
  readPaymentAuthentication?:(transaction:ProviderTransactionIntent)=>Promise<{status:'open'|'complete'|'expired';checkoutUrl?:string}>;
  approvalSecret:string;
}


function resolvedSellerDisplayName(displayName:string|null|undefined,externalAccountId:string):string{
  return validateSellerDisplayName(displayName,externalAccountId);
}
function resolvedItemTitle(line:{variantId:string;title?:string;productTitle?:string}):string{
  return validateItemTitle(line.title??line.productTitle,line.variantId);
}

// Optional review facts, sourced only from signed draft state
// top-level fields, supplied at draft creation by the authenticated
// company caller and validated in provider-transaction-draft.ts.
// No date, term, or payment time is
// invented here: an absent, empty, over-long, or raw-ID-looking value
// renders as "not available" in the review event, never as a guess.
const rawReviewIdPattern=/gid:\/\/|myshopify\.com|acct_/i;
function optionalReviewText(value:unknown):string{
  if(typeof value!=='string') return 'not available';
  const trimmed=value.trim();
  if(!trimmed||trimmed.length>1000||rawReviewIdPattern.test(trimmed)) return 'not available';
  return trimmed;
}
function reviewFactsFromState(state:unknown):{terms:string;paymentTiming:string;estimatedArrival:string}{
  const record=(state && typeof state==='object' ? state : {}) as Record<string,unknown>;
  const fulfillment=(record.fulfillment && typeof record.fulfillment==='object' ? record.fulfillment : {}) as Record<string,unknown>;
  return {
    terms:optionalReviewText(record.terms ?? fulfillment.terms),
    paymentTiming:optionalReviewText(record.paymentTiming ?? fulfillment.paymentTiming),
    estimatedArrival:optionalReviewText(record.estimatedArrival ?? fulfillment.estimatedArrival),
  };
}

/** Request-scoped host; instantiate only after verifying OIDC. Do not create
 * identity or dependencies from model output, Reel metadata or browser JSON. */
export class AuthenticatedMuseCommerceHost implements MuseToolAgentHost {
  private readonly request:MuseAgentRequest;
  private readonly identity:{subjectId:string;email?:string};
  private fallbackUrl?:string;
  readonly events:Array<Record<string,unknown>>=[];
  constructor(identity:{subjectId:string;email?:string},request:MuseAgentRequest,private readonly deps:MuseHostDependencies){
    this.identity={...identity};this.request={...request};
    if(!identity.subjectId||!deps.approvalSecret) throw Error('muse_agent_host_not_configured');
  }
  private async paymentAuthentication(transaction:ProviderTransactionIntent){
    if(transaction.state!=='CHECKOUT_CREATED'){this.fallbackUrl=undefined;return;}
    if(transaction.state!=='CHECKOUT_CREATED'||transaction.paymentReferenceKind!=='checkout_session'||!transaction.paymentReference||!this.deps.readPaymentAuthentication) return;
    const session=await this.deps.readPaymentAuthentication(transaction);
    this.fallbackUrl=session.status==='open'?assertTrustedStripeCheckoutUrl(session.checkoutUrl??''):undefined;
    if(session.status==='expired'){
      if(!this.events.some(event=>event.type==='payment_authentication_expired')) this.events.push({type:'payment_authentication_expired',draftId:transaction.draftId,next:'NEW_REVIEW_REQUIRED'});
    }
  }
  private async owned(){
    const connection=await this.deps.authority.resolve(this.request.connectionId);
    if(!connection||connection.subjectId!==this.identity.subjectId) throw Error('consumer_agent_not_found');
    const transaction=await this.deps.transactions.getForConsumer(this.identity.subjectId,this.request.draftId);
    if(transaction&&(transaction.companyId!==connection.companyId||transaction.draftId!==this.request.draftId||transaction.consumerSubjectId!==this.identity.subjectId)) throw Error('consumer_agent_not_found');
    if(!transaction&&await this.deps.transactions.get(connection.companyId,this.request.draftId)) throw Error('consumer_agent_not_found');
    return {connection,transaction};
  }
  private async tracking(transaction:ProviderTransactionIntent){
    if(transaction.state!=='ORDER_CREATED'||!this.deps.readTracking) return [];
    try{
      return (await this.deps.readTracking(transaction)).flatMap(item=>{
        if(!item.url) return [];
        const url=new URL(item.url);
        if(url.protocol!=='https:'||url.username||url.password) return [];
        return [{...(item.company?{company:item.company}:{}),...(item.number?{number:item.number}:{}),url:url.href}];
      });
    }catch{return [];}
  }
  private async executionProfile(companyId:string):Promise<MuseExecutionProfile>{
    if(!this.deps.resolveExecutionProfile) return 'reference';
    const profile=await this.deps.resolveExecutionProfile({companyId,connectionId:this.request.connectionId,draftId:this.request.draftId});
    if(profile!=='reference'&&profile!=='generic') throw Error('muse_execution_profile_invalid');
    return profile;
  }
  private async dispatchGenericExecute(step:MuseCommerceStep):Promise<{status:MusePublicToolStatus}>{
    // Equivalent gates to the reference validator, expressed for a
    // rail-independent approval: exact step scope, an approval token, an
    // owned connection, no already-recorded transaction, and the
    // per-company generic readiness gate. Exact approval binding, drift
    // revalidation, one-time consumption, and the single execution claim
    // are enforced inside submitGeneric (ZeroTrustConnectorRuntime).
    // This branch never retries: drift, expiry, replay, scope mismatch,
    // and duplicate-claim errors propagate for reapproval or rebuild,
    // and uncertain completion becomes reconciliation, not a new commit.
    if(!step.args||typeof step.args!=='object'||Array.isArray(step.args)) throw Error('muse_step_invalid');
    if(Object.keys(step.args).sort().join(',')!=='draftId'||step.args.draftId!==this.request.draftId) throw Error('muse_step_scope_mismatch');
    if(!this.request.approvalToken) throw Error('approval_token_required');
    const {connection,transaction}=await this.owned();
    if(transaction) throw Error('muse_generic_execution_already_recorded');
    if(!this.deps.genericReadiness) throw Error('muse_generic_readiness_not_configured');
    if(!await this.deps.genericReadiness(connection.companyId)) throw Error('muse_generic_business_not_ready');
    if(!this.deps.submitGeneric) throw Error('muse_generic_submit_not_configured');
    let result:MuseGenericExecutionResult|null=null;
    try{
      result=await this.deps.submitGeneric({subjectId:this.identity.subjectId,
        ...(this.identity.email?{consumerEmail:this.identity.email}:{}),companyId:connection.companyId,
        connectionId:this.request.connectionId,draftId:this.request.draftId,approvalToken:this.request.approvalToken});
    }catch(error){
      if(error instanceof Error&&/execution_uncertain|provider_commit_uncertain|commit_status_unknown/.test(error.message)){
        this.events.push({type:'reconciliation_required',draftId:this.request.draftId,connectionId:this.request.connectionId});
        return {status:'reconciliation_required'};
      }
      throw error;
    }
    if(!result||result.status==='UNCERTAIN'){
      this.events.push({type:'reconciliation_required',draftId:this.request.draftId,connectionId:this.request.connectionId,
        ...(result?.executionId?{executionId:result.executionId}:{})});
      return {status:'reconciliation_required'};
    }
    if(result.status==='CONFIRMED') return {status:'payment_processing'};
    throw Error('muse_generic_execution_not_confirmed');
  }
  async readContext():Promise<MuseCommerceContext>{
    const {connection,transaction}=await this.owned();
    const base={intentId:this.request.draftId,productResolved:true,businessReady:true,consumerEnrolled:true,missingDetails:[]};
    if(transaction){
      await this.paymentAuthentication(transaction);
      const state=transaction.state;
      const mapped=state==='ORDER_CREATED'?'ORDER_CREATED':state==='RECONCILE_REQUIRED'?'RECONCILE_REQUIRED':
        state==='REFUNDED'?'REFUNDED':state.startsWith('REFUND_')?'REFUND_PENDING':this.fallbackUrl?'AUTHENTICATION_REQUIRED':'IN_PROGRESS';
      return {...base,execution:{state:mapped,draftId:transaction.draftId,
        ...(state==='ORDER_CREATED'?{trackingStatus:(await this.tracking(transaction)).length?'AVAILABLE' as const:'PENDING' as const}:{})}};
    }
    if((await this.executionProfile(connection.companyId))==='generic'){
      // Generic enrollment is the owned ZeroTrust connection itself, not a
      // Stripe saved payment, and approval is rail-independent, so no
      // paymentAuthorizationReference is set here. The reference step
      // validator's Stripe saved-payment condition cannot express that
      // approval, which is why generic executes take the dedicated branch
      // in dispatch() with equivalent gates instead of that validator.
      if(!this.deps.genericDraft) throw Error('muse_generic_draft_not_configured');
      const generic=await this.deps.genericDraft({companyId:connection.companyId,connectionId:this.request.connectionId,draftId:this.request.draftId});
      if(!generic) throw Error('muse_generic_draft_not_found');
      const genericReady=this.deps.genericReadiness?await this.deps.genericReadiness(connection.companyId):false;
      const genericExpected={subjectId:this.identity.subjectId,companyId:connection.companyId,connectionId:this.request.connectionId,
        draftId:this.request.draftId,draftHash:generic.draftHash,amount:generic.total,currency:generic.currency};
      const genericApproval=this.request.approvalToken?verifyApproval({token:this.request.approvalToken,secret:this.deps.approvalSecret,expected:genericExpected}):null;
      return {...base,businessReady:genericReady,consumerEnrolled:true,
        draft:{draftId:this.request.draftId,draftHash:generic.draftHash,expiresAt:generic.expiresAt,paymentAuthorizationReference:''},
        ...(this.request.approvalToken?{approval:{verified:Boolean(genericApproval?.ok),draftId:this.request.draftId,draftHash:generic.draftHash,
          paymentAuthorizationReference:'',expiresAt:genericApproval?.ok?genericApproval.claims.expiresAt:new Date(0).toISOString()}}:{})};
    }
    const verified=await this.deps.drafts.verifyForExecution({companyId:connection.companyId,connectionId:this.request.connectionId,draftId:this.request.draftId});
    const saved=await this.deps.identities.resolveStripeSavedPayment(this.identity.subjectId);
    const businessReady=await this.deps.businessReady(connection.companyId,verified.state.fulfillment.externalAccountId);
    const expected={subjectId:this.identity.subjectId,companyId:connection.companyId,connectionId:this.request.connectionId,
      draftId:this.request.draftId,draftHash:verified.draftHash,amount:verified.draft.total,currency:verified.draft.currency,
      paymentAuthorizationReference:saved?.reference??''};
    const approval=this.request.approvalToken&&saved?verifyApproval({token:this.request.approvalToken,secret:this.deps.approvalSecret,expected}):null;
    return {...base,businessReady,consumerEnrolled:Boolean(saved),
      draft:{draftId:this.request.draftId,draftHash:verified.draftHash,expiresAt:verified.draft.expiresAt,paymentAuthorizationReference:saved?.reference??''},
      ...(this.request.approvalToken?{approval:{verified:Boolean(approval?.ok),draftId:this.request.draftId,draftHash:verified.draftHash,
        paymentAuthorizationReference:saved?.reference??'',expiresAt:approval?.ok?approval.claims.expiresAt:new Date(0).toISOString()}}:{})};
  }
  async dispatch(step:MuseCommerceStep):Promise<{status:MusePublicToolStatus}>{
    if(step.action==='execute_approved_purchase'){
      // Route by draft capability before the reference validator: a
      // generic draft has no Stripe saved payment, so the reference
      // validator could never authorize it. The generic branch above
      // enforces the equivalent gates; the reference path below is
      // byte-for-byte unchanged in behavior.
      const {connection}=await this.owned();
      if((await this.executionProfile(connection.companyId))==='generic') return this.dispatchGenericExecute(step);
    }
    // Also validate here so direct host callers cannot bypass the model runner.
    validateMuseCommerceStep(step,await this.readContext());
    if(step.action==='execute_approved_purchase'){
      if(!this.request.approvalToken) throw Error('approval_token_required');
      const result=await this.deps.submit({subjectId:this.identity.subjectId,
        ...(this.identity.email?{consumerEmail:this.identity.email}:{}),connectionId:this.request.connectionId,
        draftId:this.request.draftId,approvalToken:this.request.approvalToken});
      if(result.handoff.required){
        this.fallbackUrl=assertTrustedStripeCheckoutUrl(result.checkoutUrl??'');
        this.events.push({type:'payment_authentication',url:this.fallbackUrl});
        return {status:'payment_authentication_required'};
      }
      return {status:'payment_processing'};
    }
    if(step.action==='present_review'||step.action==='request_reapproval'){
      const {connection}=await this.owned();
      const verified=await this.deps.drafts.verifyForExecution({companyId:connection.companyId,connectionId:this.request.connectionId,draftId:this.request.draftId});
      const state=verified.state;const landed=state.fulfillment.landedQuote;
      if(!landed||!state.fulfillment.shippingAddress) throw Error('provider_landed_quote_required');
      // Server-owned supply, in order: (1) the signed draft state,
      // which only an authenticated company caller could have populated
      // at draft creation; (2) the injected manifest resolver, which
      // must come from a company manifest/connection, never from the
      // shop domain. No fallback to externalAccountId exists.
      const stateDisplayName = state.fulfillment.sellerDisplayName;
      const manifestDisplayName = stateDisplayName ? null
        : (this.deps.resolveSellerDisplayName ? await this.deps.resolveSellerDisplayName(connection.companyId) : null);
      const seller=resolvedSellerDisplayName(
        stateDisplayName ?? manifestDisplayName,
        state.fulfillment.externalAccountId);
      const items=state.pricing.lines.map((line)=>({title:resolvedItemTitle(line),quantity:line.quantity,unitPrice:line.unitPrice}));
      const reviewFacts=reviewFactsFromState(state);
      this.events.push({type:'review',requiresBuy:true,connectionId:this.request.connectionId,draftId:this.request.draftId,
        displayedDraftHash:verified.draftHash,expiresAt:verified.draft.expiresAt,description:state.description,
        seller,items,...reviewFacts,
        shippingAddress:state.fulfillment.shippingAddress,shipping:landed.shipping,subtotal:landed.subtotal,tax:landed.tax,total:landed.total,
        currency:landed.currency,paymentLabel:'Saved payment'});
      return {status:'review_required'};
    }
    if(step.action==='open_payment_authentication'){
      if(!this.fallbackUrl) throw Error('payment_authentication_not_available');
      assertTrustedStripeCheckoutUrl(this.fallbackUrl);
      if(!this.events.some(event=>event.type==='payment_authentication')) this.events.push({type:'payment_authentication',url:this.fallbackUrl});
      return {status:'payment_authentication_required'};
    }
    if(['read_order','complete','read_refund_status','escalate_reconciliation'].includes(step.action)){
      const {transaction}=await this.owned();if(!transaction) throw Error('consumer_order_not_found');
      const tracking=await this.tracking(transaction);
      this.events.push({type:'order_status',draftId:transaction.draftId,state:transaction.state,tracking});
      const state=transaction.state;
      return {status:state==='REFUNDED'?'refunded':state.startsWith('REFUND_')?'refund_pending':state==='RECONCILE_REQUIRED'?'reconciliation_required':state==='ORDER_CREATED'?(tracking.length?'tracking_available':'order_created'):'payment_processing'};
    }
    if(step.action==='request_enrollment') return {status:'enrollment_required'};
    if(step.action==='request_business_connection') return {status:'business_connection_required'};
    throw Error('muse_agent_action_not_supported');
  }
}
