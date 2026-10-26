export type ShoppingEntityKind=
  | 'PRODUCT'
  | 'TRAVEL'
  | 'TICKET'
  | 'SERVICE'
  | 'RESERVATION'
  | 'DIGITAL';

export type ShoppingActionKind=
  | 'VIEW'
  | 'CONFIGURE'
  | 'ADD_TO_CART'
  | 'BOOK'
  | 'BUY';

export interface ShoppingEvidence {
  sourceId:string;
  observedAt:string;
  sourceType:'COMPANY_CONNECTOR'|'MERCHANT_API'|'BOOKING_API'|'CATALOG'|'OTHER';
  fields:string[];
}

export interface ShoppingOffer {
  offerId:string;
  companyId:string;
  entityId:string;
  kind:ShoppingEntityKind;
  title:string;
  summary?:string;
  price:number;
  currency:string;
  availability:'AVAILABLE'|'LIMITED'|'UNAVAILABLE'|'UNKNOWN';
  destinationOrRegion?:string;
  fulfillmentMode?:'SHIP'|'PICKUP'|'DIGITAL'|'BOOKING'|'SERVICE';
  deliveryOrStartAt?:string;
  attributes:Record<string,string|number|boolean|null>;
  intents:string[];
  actions:ShoppingActionKind[];
  evidence:ShoppingEvidence[];
}

export interface ShoppingIntent {
  query:string;
  maxPrice?:number;
  currency?:string;
  destinationOrRegion?:string;
  neededBy?:string;
  interests?:string[];
  avoid?:string[];
  preferredKinds?:ShoppingEntityKind[];
}

export interface IndexedResult {
  offer:ShoppingOffer;
  score:number;
  reasons:string[];
}

const clamp=(n:number)=>Math.max(0,Math.min(100,n));
const words=(value:string)=>value.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2);

export function indexEligibility(offer:ShoppingOffer,now=new Date()){
  const reasons:string[]=[];
  if(!offer.title.trim()) reasons.push('missing_title');
  if(!Number.isFinite(offer.price)||offer.price<0) reasons.push('invalid_price');
  if(!offer.currency.trim()) reasons.push('missing_currency');
  if(offer.availability!=='AVAILABLE'&&offer.availability!=='LIMITED') reasons.push('not_actionable');
  if(!offer.actions.length) reasons.push('no_actions');
  if(!offer.evidence.length) reasons.push('no_evidence');
  if(offer.evidence.some(item=>Number.isNaN(new Date(item.observedAt).getTime())||new Date(item.observedAt).getTime()>now.getTime()+60_000)){
    reasons.push('invalid_evidence_time');
  }
  return {eligible:reasons.length===0,reasons};
}

export function scoreShoppingOffer(intent:ShoppingIntent,offer:ShoppingOffer){
  const reasons:string[]=[];
  const queryTerms=words(intent.query);
  const haystack=words([
    offer.title,
    offer.summary??'',
    ...offer.intents,
    ...Object.values(offer.attributes).map(String)
  ].join(' '));

  const matches=queryTerms.filter(term=>haystack.some(value=>value.includes(term)||term.includes(value))).length;
  const semantic=queryTerms.length?Math.min(100,(matches/queryTerms.length)*100):50;
  if(matches) reasons.push(`${matches} intent terms matched`);

  let budget=70;
  if(intent.maxPrice!==undefined){
    budget=offer.price<=intent.maxPrice?100:Math.max(0,100-(offer.price-intent.maxPrice));
    reasons.push(offer.price<=intent.maxPrice?'within budget':'over requested budget');
  }

  const currency=!intent.currency||intent.currency===offer.currency?100:0;
  if(currency===0) reasons.push('currency mismatch');

  const region=!intent.destinationOrRegion||!offer.destinationOrRegion||
    offer.destinationOrRegion.toLowerCase().includes(intent.destinationOrRegion.toLowerCase())?100:30;

  const evidence=Math.min(100,offer.evidence.length*25);
  const availability=offer.availability==='AVAILABLE'?100:70;
  const actionability=offer.actions.includes('BUY')||offer.actions.includes('BOOK')?100:offer.actions.includes('ADD_TO_CART')?85:60;

  const score=clamp(
    semantic*.34+
    budget*.18+
    currency*.08+
    region*.08+
    evidence*.10+
    availability*.10+
    actionability*.12
  );

  return {score:Math.round(score),reasons};
}

export function searchShoppingIndex(intent:ShoppingIntent,offers:ShoppingOffer[],limit=10,now=new Date()):IndexedResult[]{
  return offers
    .filter(offer=>indexEligibility(offer,now).eligible)
    .filter(offer=>!intent.preferredKinds?.length||intent.preferredKinds.includes(offer.kind))
    .filter(offer=>!intent.avoid?.some(term=>[
      offer.title,
      offer.summary??'',
      ...offer.intents
    ].join(' ').toLowerCase().includes(term.toLowerCase())))
    .map(offer=>({offer,...scoreShoppingOffer(intent,offer)}))
    .sort((a,b)=>b.score-a.score||a.offer.price-b.offer.price)
    .slice(0,Math.max(1,Math.min(limit,100)));
}

export function mergeCompanyOffers(current:ShoppingOffer[],incoming:ShoppingOffer[]){
  const map=new Map(current.map(offer=>[offer.offerId,offer]));
  for(const offer of incoming) map.set(offer.offerId,offer);
  return [...map.values()];
}

export * from './learning.js';

export * from './company-learning.js';
