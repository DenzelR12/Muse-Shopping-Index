export interface FulfillmentEvidence {supplierCode:string;region:string;dispatchDays:number;promisedDays?:number;actualDays?:number;lateRate?:number;trackingPresent:boolean;inStock:boolean}
export function deliveryConfidence(e:FulfillmentEvidence){
  let s=100; if(!e.inStock)s-=60; if(!e.trackingPresent)s-=20; s-=Math.min(25,e.dispatchDays*4); s-=Math.min(25,(e.lateRate??0)*100);
  if(e.promisedDays&&e.actualDays&&e.actualDays>e.promisedDays)s-=10;
  return Math.max(0,Math.round(s));
}
