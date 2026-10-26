import type { BundleResultsView } from './bundles.js';

export interface StorefrontBundleRequest {
  context: Record<string, unknown>;
  candidates: Array<Record<string, unknown>>;
  sessionId: string;
  requestId: string;
}


export interface MuseConfirmationCommitRequest {
  connectionId:string;
  draftId:string;
  displayedDraftHash:string;
  identityToken:string;
}

export type MuseConfirmationCommitResult =
  | {
      checkoutSessionId:string;
      checkoutUrl:string;
      status:string;
      paymentRail:'stripe';
      handoff:{required:true;kind:'payment_rail';provider:'stripe'};
      execution:{fulfillmentMode:'server_api';merchantHandoffRequired:false};
    }
  | {
      paymentIntentId:string;
      status:'succeeded'|'processing';
      paymentRail:'stripe';
      handoff:{required:false;kind:'none';provider:'stripe'};
      execution:{fulfillmentMode:'server_api';merchantHandoffRequired:false};
    };

export interface ConsumerCommerceEnrollmentRequest {
  enrollmentId:string;
  identityToken:string;
}

export interface ConsumerCommerceEnrollmentResult {
  enrolled:true;
  paymentRail:'stripe';
  shopIdentityVerified:true;
}

export interface StorefrontInteraction {
  name: 'bundle_viewed'|'bundle_item_removed'|'bundle_item_swapped'|'bundle_added_to_cart'|'bundle_checkout_started'|'bundle_purchased';
  sessionId: string;
  requestId: string;
  bundleId: string;
  currency: string;
  productIds: string[];
  totalValue: number;
  targetBudget?: number;
  hardBudget?: boolean;
  attributes?: Record<string,string|number|boolean|null>;
}

export class GiftSignalApiClient {
  constructor(private readonly baseUrl: string) {}

  async buildBundles(request: StorefrontBundleRequest): Promise<BundleResultsView> {
    const response=await fetch(`${this.baseUrl}/v1/bundles/build`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...request,source:'storefront'})});
    if(!response.ok) throw new Error(`bundle_build_failed:${response.status}`);
    const payload=await response.json() as {bundles:Array<any>};
    return {
      requestId:request.requestId,
      hardBudget:Boolean((request.context as {hardBudget?:boolean}).hardBudget),
      bundles:payload.bundles.map(bundle=>({
        bundleId:bundle.bundleId,
        label:bundle.mode==='SMARTER_VALUE_CART'?'SMARTER VALUE CART':bundle.mode==='UPGRADE_THE_SIGNAL'?'UPGRADE THE SIGNAL':'BEST COMPLETE CART',
        total:bundle.total,
        targetBudget:bundle.targetBudget,
        budgetUtilizationPercent:bundle.budgetUtilizationPercent,
        items:bundle.items.map((item:any)=>({productId:item.productId,title:item.title,price:item.price,currency:item.currency,role:item.bundleRoles?.[0]??'gift',whyItFits:item.semanticSummary??'Selected for fit, availability, and budget.'})),
        whyTogether:bundle.whyTogether
      }))
    };
  }


  async commitMuseConfirmation(request:MuseConfirmationCommitRequest):Promise<MuseConfirmationCommitResult>{
    const headers={'content-type':'application/json',authorization:`Bearer ${request.identityToken}`};
    const approvalResponse=await fetch(`${this.baseUrl}/v1/muse/approvals/issue`,{
      method:'POST',
      headers,
      body:JSON.stringify({
        connectionId:request.connectionId,
        draftId:request.draftId,
        displayedDraftHash:request.displayedDraftHash,
        approved:true
      })
    });
    if(!approvalResponse.ok){
      const failure=await approvalResponse.json().catch(()=>({})) as {error?:string};
      throw new Error(`${failure.error??'muse_approval_failed'}:${approvalResponse.status}`);
    }
    const approval=await approvalResponse.json() as {approvalToken?:string};
    if(!approval.approvalToken) throw new Error('muse_approval_token_missing');

    const confirmationResponse=await fetch(`${this.baseUrl}/v1/muse/confirm`,{
      method:'POST',
      headers,
      body:JSON.stringify({
        connectionId:request.connectionId,
        draftId:request.draftId,
        approvalToken:approval.approvalToken
      })
    });
    if(!confirmationResponse.ok){
      const failure=await confirmationResponse.json().catch(()=>({})) as {error?:string};
      const code=failure.error??'muse_confirmation_failed';
      throw new Error(`${code}:${confirmationResponse.status}`);
    }
    const payload=await confirmationResponse.json() as {checkout?:MuseConfirmationCommitResult};
    const checkout=payload.checkout;
    if(!checkout||checkout.paymentRail!=='stripe') throw new Error('muse_payment_result_missing');
    if(checkout.handoff.required){
      if(!('checkoutSessionId' in checkout)||!checkout.checkoutSessionId||!checkout.checkoutUrl) throw new Error('muse_checkout_missing');
    }else{
      if(!('paymentIntentId' in checkout)||!checkout.paymentIntentId) throw new Error('muse_direct_payment_missing');
    }
    return checkout;
  }

  async startConsumerCommerceEnrollment(identityToken:string):Promise<{enrollmentId:string;clientSecret:string}>{
    const response=await fetch(`${this.baseUrl}/v1/consumer-commerce/enrollment/start`,{
      method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${identityToken}`},body:'{}'
    });
    if(!response.ok){
      const failure=await response.json().catch(()=>({})) as {error?:string};
      throw new Error(`${failure.error??'consumer_commerce_enrollment_failed'}:${response.status}`);
    }
    const payload=await response.json() as {enrollmentId?:string;clientSecret?:string};
    if(!payload.enrollmentId||!payload.clientSecret) throw new Error('consumer_commerce_enrollment_invalid_response');
    return {enrollmentId:payload.enrollmentId,clientSecret:payload.clientSecret};
  }

  async enrollConsumerCommerce(request:ConsumerCommerceEnrollmentRequest):Promise<ConsumerCommerceEnrollmentResult>{
    const response=await fetch(`${this.baseUrl}/v1/consumer-commerce/enrollment/complete`,{
      method:'POST',
      headers:{'content-type':'application/json',authorization:`Bearer ${request.identityToken}`},
      body:JSON.stringify({enrollmentId:request.enrollmentId})
    });
    if(!response.ok){
      const failure=await response.json().catch(()=>({})) as {error?:string};
      throw new Error(`${failure.error??'consumer_commerce_enrollment_failed'}:${response.status}`);
    }
    const payload=await response.json() as Partial<ConsumerCommerceEnrollmentResult>;
    if(payload.enrolled!==true||payload.paymentRail!=='stripe'||payload.shopIdentityVerified!==true){
      throw new Error('consumer_commerce_enrollment_invalid_response');
    }
    return payload as ConsumerCommerceEnrollmentResult;
  }

  async commitMuseWithEnrollment(args:{
    confirmation:MuseConfirmationCommitRequest;
    confirmSetupIntent:(clientSecret:string)=>Promise<void>;
    shouldEnroll?:(error:Error)=>boolean;
  }):Promise<MuseConfirmationCommitResult>{
    try{
      return await this.commitMuseConfirmation(args.confirmation);
    }catch(error){
      const failure=error instanceof Error?error:new Error('muse_confirmation_failed');
      const shouldEnroll=args.shouldEnroll??((value:Error)=>
        /consumer_commerce|shop_identity_claim_required|payment_authorization/.test(value.message)
      );
      if(!shouldEnroll(failure)) throw failure;
      const setup=await this.startConsumerCommerceEnrollment(args.confirmation.identityToken);
      await args.confirmSetupIntent(setup.clientSecret);
      await this.enrollConsumerCommerce({
        enrollmentId:setup.enrollmentId,
        identityToken:args.confirmation.identityToken
      });
      return this.commitMuseConfirmation(args.confirmation);
    }
  }

  async recordInteraction(interaction: StorefrontInteraction): Promise<void> {
    const response=await fetch(`${this.baseUrl}/v1/bundles/interactions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...interaction,source:'storefront'})});
    if(!response.ok) throw new Error(`bundle_interaction_failed:${response.status}`);
  }
}

