export type ShoppingOutcomeType =
  | 'IMPRESSION'
  | 'OPENED'
  | 'DRAFTED'
  | 'APPROVED'
  | 'PURCHASED'
  | 'DELIVERED'
  | 'RETURNED'
  | 'CANCELLED'
  | 'SATISFIED';

export interface ShoppingOutcome {
  eventId:string;
  offerId:string;
  companyId:string;
  kind:string;
  intentFingerprint:string;
  outcome:ShoppingOutcomeType;
  occurredAt:string;
  value?:number;
  satisfaction?:number;
}

export interface LearnedSignal {
  offerId:string;
  observations:number;
  conversionRate:number;
  fulfillmentRate:number;
  returnRate:number;
  satisfaction:number;
  confidence:number;
  scoreAdjustment:number;
}

const bounded=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));

const weights:Record<ShoppingOutcomeType,number>={
  IMPRESSION:0,
  OPENED:0.05,
  DRAFTED:0.15,
  APPROVED:0.3,
  PURCHASED:0.5,
  DELIVERED:0.7,
  RETURNED:-0.8,
  CANCELLED:-0.6,
  SATISFIED:1
};

export function summarizeLearning(outcomes:ShoppingOutcome[]):Map<string,LearnedSignal>{
  const grouped=new Map<string,ShoppingOutcome[]>();
  for(const event of outcomes){
    const list=grouped.get(event.offerId)??[];
    list.push(event);
    grouped.set(event.offerId,list);
  }

  const result=new Map<string,LearnedSignal>();
  for(const [offerId,events] of grouped){
    const impressions=Math.max(1,events.filter(e=>e.outcome==='IMPRESSION').length);
    const purchases=events.filter(e=>e.outcome==='PURCHASED').length;
    const deliveries=events.filter(e=>e.outcome==='DELIVERED').length;
    const returns=events.filter(e=>e.outcome==='RETURNED').length;
    const satisfactionEvents=events.filter(e=>e.outcome==='SATISFIED'&&typeof e.satisfaction==='number');
    const avgSatisfaction=satisfactionEvents.length
      ? satisfactionEvents.reduce((sum,e)=>sum+bounded((e.satisfaction??0)/5),0)/satisfactionEvents.length
      : 0.5;

    const weighted=events.reduce((sum,e)=>sum+weights[e.outcome],0);
    const confidence=1-Math.exp(-events.length/20);
    const rawAdjustment=bounded((weighted/Math.max(1,events.length)+1)/2)*20-10;

    result.set(offerId,{
      offerId,
      observations:events.length,
      conversionRate:bounded(purchases/impressions),
      fulfillmentRate:purchases?bounded(deliveries/purchases):0,
      returnRate:purchases?bounded(returns/purchases):0,
      satisfaction:Number(avgSatisfaction.toFixed(3)),
      confidence:Number(confidence.toFixed(3)),
      scoreAdjustment:Number((rawAdjustment*confidence).toFixed(2))
    });
  }
  return result;
}

export function applyLearnedAdjustment(baseScore:number,signal:LearnedSignal|undefined){
  if(!signal) return {score:baseScore,adjustment:0,reasons:['cold-start: no outcome history']};
  const score=Math.max(0,Math.min(100,Math.round(baseScore+signal.scoreAdjustment)));
  const reasons=[
    `${signal.observations} outcome observations`,
    `${Math.round(signal.conversionRate*100)}% observed purchase conversion`,
    `${Math.round(signal.fulfillmentRate*100)}% observed fulfillment`,
    `${Math.round(signal.returnRate*100)}% observed return rate`
  ];
  return {score,adjustment:signal.scoreAdjustment,reasons};
}

export function intentFingerprint(parts:{
  normalizedQuery:string;
  kind?:string;
  region?:string;
  budgetBucket?:string;
}){
  return [
    parts.normalizedQuery.trim().toLowerCase(),
    parts.kind?.toLowerCase()??'any',
    parts.region?.trim().toLowerCase()??'any',
    parts.budgetBucket?.toLowerCase()??'any'
  ].join('|');
}
