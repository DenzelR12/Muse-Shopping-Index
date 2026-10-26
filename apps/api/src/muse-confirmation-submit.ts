import {verifyApproval} from '@gift-signal/zero-trust';
import {decimalPriceToMinorUnits,landedQuoteTotalAmount,type PostgresZeroTrustAuthority} from '@gift-signal/mcp-gateway';
import type {ProviderTransactionDraftService} from './provider-transaction-draft.js';
import type {ProviderRuntimeControlPlane} from './provider-runtime-control.js';
import type {ProviderTransactionExecutionService} from './provider-transaction-execution.js';

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
  savedStripeAuthorization:{reference:string;customerId:string;paymentMethodId:string;usage:'off_session'};
  requestId?:string;
}){
  const connection=await args.authority.resolve(args.connectionId);
  if(!connection) throw new Error('connection_not_found');
  if(connection.subjectId!==args.subjectId) throw new Error('approval_identity_mismatch');
  if(!args.savedStripeAuthorization?.reference?.trim()) throw new Error('consumer_commerce_enrollment_required');
  const verified=await args.drafts.verifyForExecution({
    companyId:connection.companyId,
    connectionId:args.connectionId,
    draftId:args.draftId
  });
  const state=verified.state;
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
      paymentAuthorizationReference:args.savedStripeAuthorization.reference
    }
  });
  if(!approval.ok) throw new Error(approval.reason);

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
    savedStripeAuthorization:args.savedStripeAuthorization
  });
}

