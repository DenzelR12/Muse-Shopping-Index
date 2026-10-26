import {refundStripeCheckout,type StripeRefundResult} from '@gift-signal/payments';
import type {PostgresProviderTransactionIntentStore} from './provider-transaction-store.js';
import type {ProviderSecurityAuditor} from './provider-security-audit.js';

export class ProviderRefundCompensationService {
  constructor(
    private readonly intents:PostgresProviderTransactionIntentStore,
    private readonly auditor?:ProviderSecurityAuditor,
    private readonly stripeSecret=process.env.STRIPE_SECRET_KEY
  ){}

  async refund(args:{
    companyId:string;
    draftId:string;
    requestId?:string;
    fetchImpl?:typeof fetch;
  }):Promise<{refund:StripeRefundResult;transaction:NonNullable<Awaited<ReturnType<PostgresProviderTransactionIntentStore['markRefundSubmitted']>>>}>{
    if(!this.stripeSecret) throw new Error('stripe_secret_required');
    const intent=await this.intents.claimRefund(args.companyId,args.draftId);
    if(!intent) throw new Error('provider_refund_not_required');
    if(intent.paymentProvider!=='stripe') {
      await this.intents.restoreRefundRequired(args.companyId,args.draftId);
      throw new Error('provider_refund_payment_provider_not_supported');
    }
    if(!intent.checkoutSessionId) {
      await this.intents.restoreRefundRequired(args.companyId,args.draftId);
      throw new Error('provider_refund_checkout_session_missing');
    }

    try{
      const refund=await refundStripeCheckout({
        checkoutSessionId:intent.checkoutSessionId,
        companyId:intent.companyId,
        draftId:intent.draftId,
        secretKey:this.stripeSecret,
        fetchImpl:args.fetchImpl
      });
      const transaction=await this.intents.markRefundSubmitted(intent.companyId,intent.draftId,refund.refundId);
      if(!transaction) throw new Error('provider_refund_persist_failed');
      await this.auditor?.record('provider.transaction.refund_submitted',{
        companyId:intent.companyId,
        provider:intent.paymentProvider,
        externalAccountId:intent.paymentExternalAccountId,
        draftId:intent.draftId,
        amount:intent.amount,
        currency:intent.currency,
        requestId:args.requestId
      });
      return {refund,transaction};
    }catch(error){
      if((error instanceof Error?error.message:'')!=='provider_refund_persist_failed'){
        await this.intents.restoreRefundRequired(intent.companyId,intent.draftId);
      }
      throw error;
    }
  }
}
