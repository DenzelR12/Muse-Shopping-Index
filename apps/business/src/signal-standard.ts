import type { ProductCandidate } from '@gift-signal/schemas';
import { productContextHealth } from './product-context.js';

export type ProductRoute = 'DIRECT_CHECKOUT'|'PRIVATE_ACQUISITION'|'HOLD_FOR_REVIEW';

/**
 * Deterministic merchandising controls for the customer-facing Signal Standard.
 * These are operational safeguards, not legal or financial-risk determinations.
 */
export function signalStandardReadiness(product:ProductCandidate):{eligible:boolean;route:ProductRoute;reasons:string[]} {
 const health=productContextHealth(product);
 if(!health.ready)return {eligible:false,route:'HOLD_FOR_REVIEW',reasons:health.missing};
 if(!Number.isFinite(product.price)||product.price<=0)return {eligible:false,route:'HOLD_FOR_REVIEW',reasons:['valid current price']};
 // Values at this level are held because they commonly indicate an import-unit or supplier-price error.
 if(product.price>=250000)return {eligible:false,route:'HOLD_FOR_REVIEW',reasons:['price outlier requires merchant review']};
 if(product.price>=2500)return {eligible:true,route:'PRIVATE_ACQUISITION',reasons:['high-value item requires configuration, fulfillment, tax, and delivery confirmation before payment']};
 return {eligible:true,route:'DIRECT_CHECKOUT',reasons:['verified product context is complete']};
}

export interface SignalStandardDashboard {
 total:number;
 directCheckout:number;
 privateAcquisition:number;
 heldForReview:number;
 reviewQueue:Array<{productId:string;title:string;reasons:string[]}>;
}

/** A concise operational queue for merchandising and catalog review. */
export function signalStandardDashboard(products:ProductCandidate[]):SignalStandardDashboard {
 const dashboard:SignalStandardDashboard={total:products.length,directCheckout:0,privateAcquisition:0,heldForReview:0,reviewQueue:[]};
 for(const product of products){
  const readiness=signalStandardReadiness(product);
  if(readiness.route==='DIRECT_CHECKOUT')dashboard.directCheckout++;
  if(readiness.route==='PRIVATE_ACQUISITION')dashboard.privateAcquisition++;
  if(readiness.route==='HOLD_FOR_REVIEW'){dashboard.heldForReview++;dashboard.reviewQueue.push({productId:product.productId,title:product.title,reasons:readiness.reasons});}
 }
 return dashboard;
}
