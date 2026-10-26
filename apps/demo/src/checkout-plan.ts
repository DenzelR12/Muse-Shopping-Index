import {randomUUID} from 'node:crypto';
import type {ShoppingOffer} from '@gift-signal/shopping-index';

export type CheckoutMissingField=
  | 'shop_identity'
  | 'payment_authorization'
  | 'shipping_address'
  | 'quantity'
  | 'confirmation_email';

export interface CheckoutConsumerContext {
  subjectId?:string;
  shopUserPublicId?:string;
  shopIdentityVerifiedAt?:string;
  paymentAuthorization?:{
    rail:'shop_pay'|'stripe';
    reference:string;
    verifiedAt:string;
  };
  shippingAddress?:{
    name?:string;
    address1:string;
    address2?:string;
    city:string;
    provinceCode?:string;
    countryCode:string;
    zip:string;
  };
  confirmationEmail?:string;
}

export interface MuseCheckoutPlan {
  planId:string;
  intentId:string;
  offer:{
    offerId:string;
    companyId:string;
    title:string;
    unitPrice:number;
    currency:string;
    fulfillmentMode?:ShoppingOffer['fulfillmentMode'];
  };
  quantity?:number;
  subtotal?:number;
  consumer:{
    subjectId?:string;
    shopUserPublicId?:string;
    paymentRail?:'shop_pay'|'stripe';
    confirmationEmail?:string;
    shippingAddress?:CheckoutConsumerContext['shippingAddress'];
  };
  missing:CheckoutMissingField[];
  readyForApproval:boolean;
  approvalRequired:true;
  next:'COLLECT_BATCH'|'FINAL_REVIEW';
}

const validEmail=(value:string|undefined)=>Boolean(value&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));

export function buildMuseCheckoutPlan(args:{
  intentId:string;
  offer:ShoppingOffer;
  quantity?:number;
  consumer?:CheckoutConsumerContext;
}):MuseCheckoutPlan{
  const missing:CheckoutMissingField[]=[];
  const consumer=args.consumer??{};

  if(!consumer.shopUserPublicId?.trim()||!consumer.shopIdentityVerifiedAt) missing.push('shop_identity');
  if(!consumer.paymentAuthorization?.reference?.trim()||!consumer.paymentAuthorization.verifiedAt){
    missing.push('payment_authorization');
  }
  if(args.offer.fulfillmentMode==='SHIP'){
    const a=consumer.shippingAddress;
    if(!a?.address1?.trim()||!a.city?.trim()||!a.countryCode?.trim()||!a.zip?.trim()){
      missing.push('shipping_address');
    }
  }
  if(!Number.isInteger(args.quantity)||Number(args.quantity)<1||Number(args.quantity)>10) missing.push('quantity');
  if(!validEmail(consumer.confirmationEmail)) missing.push('confirmation_email');

  const quantity=missing.includes('quantity')?undefined:Number(args.quantity);
  return {
    planId:randomUUID(),
    intentId:args.intentId,
    offer:{
      offerId:args.offer.offerId,
      companyId:args.offer.companyId,
      title:args.offer.title,
      unitPrice:args.offer.price,
      currency:args.offer.currency,
      fulfillmentMode:args.offer.fulfillmentMode
    },
    ...(quantity?{quantity,subtotal:Number((args.offer.price*quantity).toFixed(2))}:{}),
    consumer:{
      ...(consumer.subjectId?{subjectId:consumer.subjectId}:{}),
      ...(consumer.shopUserPublicId?{shopUserPublicId:consumer.shopUserPublicId}:{}),
      ...(consumer.paymentAuthorization?{paymentRail:consumer.paymentAuthorization.rail}:{}),
      ...(validEmail(consumer.confirmationEmail)?{confirmationEmail:consumer.confirmationEmail}:{}),
      ...(consumer.shippingAddress?{shippingAddress:consumer.shippingAddress}:{})
    },
    missing,
    readyForApproval:missing.length===0,
    approvalRequired:true,
    next:missing.length?'COLLECT_BATCH':'FINAL_REVIEW'
  };
}
