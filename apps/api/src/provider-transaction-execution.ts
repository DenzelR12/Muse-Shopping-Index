import {createStripeCheckout,prepareStripeDirectPayment,confirmStripeDirectPayment,cancelStripePaymentIntent,currencyAmountToMinorUnits,type StripeCheckoutResult,type StripeDirectPaymentResult} from '@gift-signal/payments';
import type {PostgresProviderConnectionStore} from './provider-connections.js';
import type {PostgresProviderAgentPolicyStore} from './provider-agent-policy.js';
import type {PostgresProviderAgentRegistry} from './provider-agent-registry.js';
import type {ProviderSecurityAuditor} from './provider-security-audit.js';
import type {PostgresProviderTransactionIntentStore} from './provider-transaction-store.js';
import type {ShopifyLandedQuote,ShopifyShippingAddress} from '@gift-signal/mcp-gateway';
import {executeShopPaySavedAuthorization,type PaymentVehicle} from './shop-pay-vehicle.js';
import type {ProviderRuntimeControlPlane} from './provider-runtime-control.js';

export type AutonomousTransactionResult =
  | (StripeCheckoutResult & {
      paymentReference:string;
      paymentReferenceKind:'checkout_session';
      execution:{fulfillmentMode:'server_api';merchantHandoffRequired:false};
    })
  | (StripeDirectPaymentResult & {
      paymentReference:string;
      paymentReferenceKind:'payment_intent';
      execution:{fulfillmentMode:'server_api';merchantHandoffRequired:false};
    });

export class ProviderTransactionExecutionService {
  constructor(
    private readonly connections:PostgresProviderConnectionStore,
    private readonly policies:PostgresProviderAgentPolicyStore,
    private readonly agents:PostgresProviderAgentRegistry,
    private readonly intents:PostgresProviderTransactionIntentStore,
    private readonly providerRuntimeControl?:ProviderRuntimeControlPlane,
    private readonly auditor?:ProviderSecurityAuditor,
    private readonly stripeSecret=process.env.STRIPE_SECRET_KEY
  ){}

  async createCheckout(args:{
    companyId:string;
    provider:string;
    externalAccountId:string;
    agentId:string;
    requestId?:string;
    draftId:string;
    consumerSubjectId?:string;
    consumerEmail?:string;
    amount:number;
    currency:string;
    description:string;
    successUrl:string;
    cancelUrl:string;
    fulfillment:{
      provider:'shopify';
      externalAccountId:string;
      lineItems:Array<{variantId:string;quantity:number}>;
      shippingAddress?:ShopifyShippingAddress;
      landedQuote?:ShopifyLandedQuote;
    };
    approval:{jti:string;consume:()=>Promise<boolean>};
    // Optional vehicle signal from the signed draft. When it is
    // 'shop_pay' this method blocks before any commit (see below),
    // even if provider was passed as 'stripe' by an older caller.
    paymentVehicle?:PaymentVehicle;
    savedStripeAuthorization?:{customerId:string;paymentMethodId:string;usage:'off_session'};
    fetchImpl?:typeof fetch;
  }):Promise<AutonomousTransactionResult>{
    // Shop Pay execution is blocked here, not routed to Stripe, and
    // NOT delegated to a client from this service: this service
    // never receives the saved Shop Pay authorization reference, so
    // it cannot execute a Shop Pay payment correctly. The
    // credential-gated Shop Pay path lives in
    // muse-confirmation-submit.ts, where the saved authorization
    // reference, drift revalidation, and exact approval binding are
    // all present before the client is called. This throw happens
    // before any connection/policy/intent lookup, approval consumption,
    // or payment attempt, so a blocked attempt commits nothing and
    // cannot be mistaken for a Stripe checkout.
    if(args.provider==='shop_pay'||args.paymentVehicle==='shop_pay') executeShopPaySavedAuthorization();
    if(args.provider!=='stripe') throw new Error('provider_transaction_not_supported');
    const connection=await this.connections.get(args.companyId,args.provider,args.externalAccountId);
    if(!connection) throw new Error('provider_connection_not_found');
    if(connection.revokedAt) throw new Error('provider_connection_not_active');
    if(!connection.grantedCapabilities.includes('order.create')) throw new Error('provider_capability_not_granted');

    const inactive=await this.agents.requireActive(args.companyId,[args.agentId]);
    if(inactive.length) throw new Error('provider_agent_not_authorized');

    const policy=await this.policies.get(args.companyId,args.provider,args.externalAccountId);
    if(!policy) throw new Error('provider_agent_policy_not_found');
    if(!policy.allowedAgents.includes(args.agentId)) throw new Error('provider_agent_not_allowed');
    if(policy.currency!==args.currency) throw new Error('provider_agent_policy_currency_mismatch');
    if(args.amount>policy.maxOrderAmount) throw new Error('provider_agent_policy_amount_exceeded');
    if(!this.stripeSecret) throw new Error('stripe_secret_required');
    if(!args.fulfillment.shippingAddress||!args.fulfillment.landedQuote) throw new Error('provider_landed_quote_required');
    if(args.fulfillment.landedQuote.currency!==args.currency) throw new Error('provider_landed_quote_currency_mismatch');
    if(!this.providerRuntimeControl) throw new Error('provider_runtime_not_configured');

    let intent=await this.intents.createPending({
      companyId:args.companyId,
      draftId:args.draftId,
      ...(args.consumerSubjectId?{consumerSubjectId:args.consumerSubjectId}:{}),
      paymentProvider:args.provider,
      paymentExternalAccountId:args.externalAccountId,
      fulfillmentProvider:args.fulfillment.provider,
      fulfillmentExternalAccountId:args.fulfillment.externalAccountId,
      fulfillmentPayload:{
        lineItems:args.fulfillment.lineItems,
        ...(args.fulfillment.shippingAddress?{shippingAddress:args.fulfillment.shippingAddress}:{}),
        ...(args.fulfillment.landedQuote?{landedQuote:args.fulfillment.landedQuote}:{})
      },
      amount:args.amount,
      currency:args.currency
    });

    if(intent.approvalJti&&intent.approvalJti!==args.approval.jti) throw new Error('provider_transaction_approval_conflict');
    if(!intent.approvalJti){
      if(!await args.approval.consume()) throw new Error('approval_replayed');
      const authorized=await this.intents.authorizePending(args.companyId,args.draftId,args.approval.jti);
      if(!authorized) throw new Error('provider_transaction_approval_persist_failed');
      intent=authorized;
    }

    if(!intent.providerDraftOrderId){
      let claimed=await this.intents.claimDraftPreparation(args.companyId,args.draftId);
      let recovering=false;
      if(!claimed){
        const current=await this.intents.get(args.companyId,args.draftId);
        if(current?.providerDraftOrderId){
          intent=current;
        }else{
          claimed=await this.intents.reclaimStaleDraftPreparation(
            args.companyId,
            args.draftId,
            new Date(Date.now()-2*60*1000)
          );
          if(!claimed) throw new Error('provider_draft_preparation_in_progress');
          recovering=true;
        }
      }
      if(claimed){
        try{
          let draftOrderId:string|undefined;
          if(recovering){
            const recovered=await this.providerRuntimeControl.findDraftOrder(
              {companyId:args.companyId,provider:args.fulfillment.provider,externalAccountId:args.fulfillment.externalAccountId},
              {
                giftSignalDraftId:args.draftId,
                landedQuote:args.fulfillment.landedQuote,
                fetchImpl:args.fetchImpl
              }
            );
            draftOrderId=recovered.result?.draftOrderId;
          }
          if(!draftOrderId){
            const created=await this.providerRuntimeControl.createDraftOrder(
              {companyId:args.companyId,provider:args.fulfillment.provider,externalAccountId:args.fulfillment.externalAccountId},
              {
                giftSignalDraftId:args.draftId,
                ...(args.consumerEmail?{email:args.consumerEmail}:{}),
                lineItems:args.fulfillment.lineItems,
                shippingAddress:args.fulfillment.shippingAddress,
                landedQuote:args.fulfillment.landedQuote,
                fetchImpl:args.fetchImpl
              }
            );
            draftOrderId=created.result.draftOrderId;
          }
          const attached=await this.intents.attachProviderDraftOrder(args.companyId,args.draftId,draftOrderId);
          if(!attached) throw new Error('provider_draft_order_attach_failed');
          intent=attached;
        }catch(error){
          // Keep DRAFT_PREPARING quarantined after any ambiguous upstream failure.
          // A stale retry must first reconcile Shopify by the stable Gift Signal tag
          // before it is allowed to create another draft order.
          throw error;
        }
      }
    }

    let blockedDirectPaymentIntentId=intent.state==='PAYMENT_FALLBACK_PENDING'&&intent.paymentReferenceKind==='payment_intent'?intent.paymentReference:undefined;
    if(args.savedStripeAuthorization?.usage==='off_session'&&intent.paymentReferenceKind!=='checkout_session'&&intent.state!=='PAYMENT_FALLBACK_PENDING'){
      const prepared=await prepareStripeDirectPayment({
        draftId:args.draftId,
        companyId:args.companyId,
        amountCents:currencyAmountToMinorUnits(args.amount,args.currency),
        currency:args.currency,
        description:args.description,
        customerId:args.savedStripeAuthorization.customerId,
        paymentMethodId:args.savedStripeAuthorization.paymentMethodId,
        ...(args.consumerEmail?{receiptEmail:args.consumerEmail}:{})
      },this.stripeSecret,args.fetchImpl);

      const attached=await this.intents.attachPaymentReference(
        args.companyId,
        args.draftId,
        {reference:prepared.paymentIntentId,kind:'payment_intent'}
      );
      if(!attached) throw new Error('provider_transaction_payment_reference_attach_failed');

      try{
        const direct=await confirmStripeDirectPayment({
          paymentIntentId:prepared.paymentIntentId,
          companyId:args.companyId,
          draftId:args.draftId,
          secretKey:this.stripeSecret,
          fetchImpl:args.fetchImpl
        });
        await this.auditor?.record('provider.transaction.direct_payment_confirmed',{
          companyId:args.companyId,
          provider:args.provider,
          externalAccountId:args.externalAccountId,
          agentId:args.agentId,
          amount:args.amount,
          currency:args.currency,
          requestId:args.requestId
        });
        return {
          ...direct,
          paymentReference:direct.paymentIntentId,
          paymentReferenceKind:'payment_intent',
          execution:{fulfillmentMode:'server_api',merchantHandoffRequired:false}
        };
      }catch(error){
        if(!(error instanceof Error)||error.message!=='stripe_payment_requires_action') throw error;
        await cancelStripePaymentIntent({
          paymentIntentId:prepared.paymentIntentId,
          companyId:args.companyId,
          draftId:args.draftId,
          secretKey:this.stripeSecret,
          fetchImpl:args.fetchImpl
        });
        const fallback=await this.intents.markPaymentFallbackPending(args.companyId,args.draftId,prepared.paymentIntentId);
        if(!fallback) throw new Error('provider_transaction_payment_fallback_persist_failed');
        intent=fallback;
        blockedDirectPaymentIntentId=prepared.paymentIntentId;
      }
    }

    const result=await createStripeCheckout({
      draftId:args.draftId,
      companyId:args.companyId,
      amountCents:currencyAmountToMinorUnits(args.amount,args.currency),
      currency:args.currency,
      description:args.description,
      successUrl:args.successUrl,
      cancelUrl:args.cancelUrl,
      ...(args.consumerEmail?{customerEmail:args.consumerEmail}:{})
    },this.stripeSecret,args.fetchImpl);

    const attached=blockedDirectPaymentIntentId
      ? await this.intents.replacePaymentReference(
          args.companyId,
          args.draftId,
          {
            fromReference:blockedDirectPaymentIntentId,
            fromKind:'payment_intent',
            toReference:result.checkoutSessionId,
            toKind:'checkout_session'
          }
        )
      : await this.intents.attachPaymentReference(
          args.companyId,
          args.draftId,
          {reference:result.checkoutSessionId,kind:'checkout_session'}
        );
    if(!attached) throw new Error('provider_transaction_checkout_attach_failed');

    await this.auditor?.record('provider.transaction.checkout_created',{
      companyId:args.companyId,
      provider:args.provider,
      externalAccountId:args.externalAccountId,
      agentId:args.agentId,
      amount:args.amount,
      currency:args.currency,
      requestId:args.requestId
    });
    return {
      ...result,
      paymentReference:result.checkoutSessionId,
      paymentReferenceKind:'checkout_session',
      execution:{fulfillmentMode:'server_api',merchantHandoffRequired:false}
    };
  }
}
