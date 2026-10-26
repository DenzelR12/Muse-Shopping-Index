import type {Quote} from './business.js';

/** Format and origin validation only. No network fetch, redirect or reachability claim. */
export function checkSourceLink(value:string,allowedHosts:readonly string[]=['thegiftsignal.com','cdn.shopify.com']){
 try{const url=new URL(value);const allowed=url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&allowedHosts.includes(url.hostname.toLowerCase());return {allowed,reachable:'NOT_CHECKED' as const,reason:allowed?'Approved HTTPS source; live availability is not checked.':'Source must use an approved HTTPS origin without credentials.'};}
 catch{return {allowed:false,reachable:'NOT_CHECKED' as const,reason:'Invalid source URL.'};}
}
export function purchasingReadiness(quote:Quote){
 const reviewFlags:string[]=[];
 if(quote.subtotalCents>=500000)reviewFlags.push('HIGH_VALUE_REVIEW');
 if(quote.lines.some(line=>line.quantity>=100))reviewFlags.push('BULK_QUANTITY_REVIEW');
 return {decision:'BLOCKED' as const,reviewFlags,requiredIntegrations:['verified business and authorized purchaser','sanctions / AML screening appropriate to the business','transaction monitoring and audit retention','live stock, shipping and tax confirmation','approved payment and checkout integration'],reason:'Purchasing is disabled. Quote checks are not AML clearance or payment authorization.'};
}
