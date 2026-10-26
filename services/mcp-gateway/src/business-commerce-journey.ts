import type {
  CompanyConnectorManifest,
  ConnectorActionDraft,
  ConnectorExecution,
  CustomerConnection,
  NormalizedOffer,
  OfferSearchRequest
} from './business-connectors.js';
import type {CommerceIntentSignal} from './business-ad-intent.js';

export type CommerceRail='SHOP'|'STRIPE'|'PROVIDER_NATIVE';

export interface CheckoutSession {
  checkoutId:string;
  rail:CommerceRail;
  companyId:string;
  connectionId:string;
  draftId:string;
  amount:number;
  currency:string;
  status:'REVIEW'|'READY_FOR_APPROVAL'|'APPROVED'|'PAID'|'FAILED';
  approvalRequired:true;
  continueUrl?:string;
  providerReference?:string;
  createdAt:string;
  expiresAt:string;
}

export interface PaymentRail {
  name:CommerceRail;
  prepare(args:{
    manifest:CompanyConnectorManifest;
    connection:CustomerConnection;
    draft:ConnectorActionDraft;
  }):Promise<CheckoutSession>;
  confirm(args:{
    session:CheckoutSession;
    approval:{approved:true;approvalId:string;approvedAt:string};
  }):Promise<CheckoutSession>;
}

export interface FulfillmentStatus {
  orderId:string;
  state:'PROCESSING'|'SHIPPED'|'DELIVERED'|'CANCELLED'|'UNKNOWN';
  carrier?:string;
  trackingNumber?:string;
  trackingUrl?:string;
  updatedAt:string;
}

export interface FulfillmentRail {
  getStatus(orderId:string,connection:CustomerConnection):Promise<FulfillmentStatus>;
}

export interface CommerceJourneySnapshot {
  intent:CommerceIntentSignal;
  offers:NormalizedOffer[];
  draft?:ConnectorActionDraft;
  checkout?:CheckoutSession;
  execution?:ConnectorExecution;
  fulfillment?:FulfillmentStatus;
}

export function chooseCommerceRail(args:{
  vertical:'retail'|'travel';
  shopCheckoutAvailable:boolean;
  stripeConnected:boolean;
  providerNativeCheckout:boolean;
}):CommerceRail{
  if(args.vertical==='retail'&&args.shopCheckoutAvailable) return 'SHOP';
  if(args.stripeConnected) return 'STRIPE';
  if(args.providerNativeCheckout) return 'PROVIDER_NATIVE';
  throw new Error('no_supported_commerce_rail');
}

export function assertCheckoutMatchesDraft(session:CheckoutSession,draft:ConnectorActionDraft){
  if(session.companyId!==draft.companyId) throw new Error('checkout_company_mismatch');
  if(session.connectionId!==draft.connectionId) throw new Error('checkout_connection_mismatch');
  if(session.draftId!==draft.draftId) throw new Error('checkout_draft_mismatch');
  if(session.amount!==draft.total||session.currency!==draft.currency) throw new Error('checkout_total_mismatch');
  return true;
}

export function createJourney(intent:CommerceIntentSignal,offers:NormalizedOffer[]):CommerceJourneySnapshot{
  return {intent,offers:structuredClone(offers)};
}

export function attachDraft(journey:CommerceJourneySnapshot,draft:ConnectorActionDraft):CommerceJourneySnapshot{
  if(draft.companyId!==journey.intent.companyId) throw new Error('draft_company_does_not_match_intent');
  return {...journey,draft:structuredClone(draft)};
}

export function attachCheckout(journey:CommerceJourneySnapshot,checkout:CheckoutSession):CommerceJourneySnapshot{
  if(!journey.draft) throw new Error('draft_required_before_checkout');
  assertCheckoutMatchesDraft(checkout,journey.draft);
  return {...journey,checkout:structuredClone(checkout)};
}

export function attachExecution(journey:CommerceJourneySnapshot,execution:ConnectorExecution):CommerceJourneySnapshot{
  if(!journey.draft) throw new Error('draft_required_before_execution');
  if(execution.draftId!==journey.draft.draftId) throw new Error('execution_draft_mismatch');
  return {...journey,execution:structuredClone(execution)};
}

export function attachFulfillment(journey:CommerceJourneySnapshot,fulfillment:FulfillmentStatus):CommerceJourneySnapshot{
  if(!journey.execution||journey.execution.status!=='CONFIRMED') throw new Error('confirmed_execution_required_before_fulfillment');
  return {...journey,fulfillment:structuredClone(fulfillment)};
}

export function offerSearchFromIntent(signal:CommerceIntentSignal,userMessage:string):OfferSearchRequest{
  return {
    query:[userMessage.trim(),...signal.intentTags,...(signal.productRefs??[])].filter(Boolean).join(' ').slice(0,1000)
  };
}
