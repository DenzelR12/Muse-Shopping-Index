import {verifyApproval} from '@gift-signal/zero-trust';
import {decimalPriceToMinorUnits,landedQuoteTotalAmount,type PostgresZeroTrustAuthority} from '@gift-signal/mcp-gateway';
import type {ProviderTransactionDraftService} from './provider-transaction-draft.js';
import type {ProviderRuntimeControlPlane} from './provider-runtime-control.js';
import type {ProviderTransactionExecutionService} from './provider-transaction-execution.js';
import {executeShopPaySavedAuthorization,assertShopPayVehicleReady,paymentLabelForVehicle,resolvePaymentVehicle,type PaymentVehicle,type ShopPayVehicleReadiness} from './shop-pay-vehicle.js';
import type {ShopPaySavedPaymentAuthorization} from './consumer-commerce-identity.js';

export async function submitMuseConfirmation(args:{
  connectionId:string;
  draftId:string;
  approvalToken:string;
  agentId:string;
  subjectId:string;
  consumerEmail?:string;
  approvalSecret:string;
  authority:Pick<PostgresZeroTrustAuthority,'resolve'|'consumeOnce'>;
  drafts:Pick<ProviderTransactionDraftService,'verifyForExecution'>;
  runtime:Pick<ProviderRuntimeControlPlane,'quoteVariants'|'quoteLandedTotal'>;
  execution:Pick<ProviderTransactionExecutionService,'createCheckout'>;
  // Stripe path (unchanged): required when the draft vehicle is
  // 'stripe'. Shop Pay path: savedShopPayAuthorization is required
  // when the draft vehicle is 'shop_pay'; the other field is ignored
  // for that vehicle, never substituted for it.
  savedStripeAuthorization?:{reference:string;customerId:string;paymentMethodId:string;usage:'off_session'};
  savedShopPayAuthorization?:ShopPaySavedPaymentAuthorization;
  // Optional server-supplied Shop Pay readiness gate. When the draft
  // vehicle is 'shop_pay' and this is supplied but not ready, the
  // submit fails with shop_pay_vehicle_not_ready after drift and
  // approval verification but before execution. When omitted, Shop
  // Pay still cannot execute: the blocked stub below throws
  // shop_pay_execution_blocked before any approval consumption or
  // commit.
  shopPayReadiness?:ShopPayVehicleReadiness;
  requestId?:string;
}){
  const connection=await args.authority.resolve(args.connectionId);
  if(!connection) throw new Error('connection_not_found');
  if(connection.subjectId!==args.subjectId) throw new Error('approval_identity_mismatch');
  // The vehicle is decided by the signed draft state, never by the
  // caller, so this only rejects a call that supplies neither
  // authorization at all, exactly as the old stripe-only path did;
  // which authorization is required is decided after
  // verifyForExecution, from the signed state.
  if(!args.savedStripeAuthorization?.reference?.trim()&&!args.savedShopPayAuthorization?.reference?.trim()) throw new Error('consumer_commerce_enrollment_required');
  const verified=await args.drafts.verifyForExecution({
    companyId:connection.companyId,
    connectionId:args.connectionId,
    draftId:args.draftId
  });
  const state=verified.state;
  // Vehicle from signed state (legacy state without the field parses
  // as 'stripe' in provider-transaction-draft.ts, so this default is
  // belt-and-braces, not a caller override).
  const paymentVehicle:PaymentVehicle=resolvePaymentVehicle({paymentProvider:state.payment.provider,paymentVehicle:(state as any).paymentVehicle});
  const savedPaymentAuthorization = paymentVehicle==='shop_pay'
    ? args.savedShopPayAuthorization
    : args.savedStripeAuthorization;
  if(!savedPaymentAuthorization?.reference?.trim()) throw new Error('consumer_commerce_enrollment_required');
  // Consumer-facing label for logs/debugging only; it is never a
  // provider or account ID. Kept here to document that the label
  // follows the signed vehicle, not the authorization supplied.
  void paymentLabelForVehicle(paymentVehicle);
  if(!state.fulfillment.shippingAddress||!state.fulfillment.landedQuote) throw new Error('provider_checkout_reapproval_required');

  const key={companyId:connection.companyId,provider:'shopify',externalAccountId:state.fulfillment.externalAccountId};
  const liveQuote=(await args.runtime.quoteVariants(key,{lineItems:state.fulfillment.lineItems})).quote;
  const liveLandedQuote=(await args.runtime.quoteLandedTotal(key,{
    lineItems:state.fulfillment.lineItems,
    shippingAddress:state.fulfillment.shippingAddress
  })).quote;

  const approvedLanded=state.fulfillment.landedQuote;
  const sameMoney=(left:string,right:string,currency:string)=>
    decimalPriceToMinorUnits(left,currency)===decimalPriceToMinorUnits(right,currency);
  const liveAmount=landedQuoteTotalAmount(liveLandedQuote);
  const changed=
    liveQuote.currency!==state.pricing.currency||
    liveLandedQuote.currency!==approvedLanded.currency||
    liveAmount!==verified.draft.total||
    liveLandedQuote.shipping.handle!==approvedLanded.shipping.handle||
    !sameMoney(liveLandedQuote.subtotal,approvedLanded.subtotal,approvedLanded.currency)||
    !sameMoney(liveLandedQuote.tax,approvedLanded.tax,approvedLanded.currency)||
    !sameMoney(liveLandedQuote.shipping.amount,approvedLanded.shipping.amount,approvedLanded.currency)||
    !sameMoney(liveLandedQuote.total,approvedLanded.total,approvedLanded.currency)||
    liveQuote.lines.length!==state.pricing.lines.length||
    liveQuote.lines.some((line,index)=>{
      const approved=state.pricing.lines[index];
      return !approved||
        line.variantId!==approved.variantId||
        line.quantity!==approved.quantity||
        decimalPriceToMinorUnits(line.unitPrice,liveQuote.currency)!==decimalPriceToMinorUnits(approved.unitPrice,state.pricing.currency)||
        line.availableForSale!==true;
    });
  if(changed) throw new Error('provider_checkout_reapproval_required');

  const approval=verifyApproval({
    token:args.approvalToken,
    secret:args.approvalSecret,
    expected:{
      subjectId:connection.subjectId,
      companyId:connection.companyId,
      connectionId:connection.connectionId,
      draftId:verified.draft.draftId,
      draftHash:verified.draftHash,
      amount:verified.draft.total,
      currency:verified.draft.currency,
      paymentAuthorizationReference:savedPaymentAuthorization.reference
    }
  });
  if(!approval.ok) throw new Error(approval.reason);

  // Shop Pay execution block, placed AFTER drift revalidation and
  // AFTER exact approval verification (draft hash / total / currency /
  // payment reference, same binding as Stripe) but BEFORE the
  // execution service is called — so the one-time approval JTI is
  // not consumed and no intent or payment is committed by a blocked
  // attempt. Drift, replay (a JTI already consumed by a Stripe
  // attempt), and approval-mismatch behaviour above are therefore
  // identical for both vehicles; only a fully valid Shop Pay attempt
  // reaches this named block instead of a Stripe checkout. The
  // execution service repeats the same block defensively for direct
  // callers, and shopPayReadiness (when supplied) is checked here too
  // so a not-ready vehicle is reported distinctly from the block.
  if(paymentVehicle==='shop_pay'){
    if(args.shopPayReadiness) assertShopPayVehicleReady(args.shopPayReadiness);
    executeShopPaySavedAuthorization();
  }

  return args.execution.createCheckout({
    companyId:connection.companyId,
    provider:state.payment.provider,
    externalAccountId:state.payment.externalAccountId,
    agentId:args.agentId,
    requestId:args.requestId,
    draftId:verified.draft.draftId,
    consumerSubjectId:args.subjectId,
    ...(args.consumerEmail?{consumerEmail:args.consumerEmail}:{}),
    amount:verified.draft.total,
    currency:verified.draft.currency,
    description:state.description,
    successUrl:state.successUrl,
    cancelUrl:state.cancelUrl,
    fulfillment:state.fulfillment,
    approval:{
      jti:approval.claims.jti,
      consume:()=>args.authority.consumeOnce('approval:'+approval.claims.jti,approval.claims.expiresAt)
    },
    paymentVehicle,
    ...(paymentVehicle==='stripe'&&args.savedStripeAuthorization?{savedStripeAuthorization:args.savedStripeAuthorization}:{})
  });
}

