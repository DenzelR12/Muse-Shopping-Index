export interface CompanyOutcomeSummary {
  companyId:string;
  observations:number;
  purchaseConversion:number;
  deliverySuccess:number;
  cancellationRate:number;
  returnRate:number;
  onTimeRate:number;
  priceCompetitiveness:number;
  explanationLift:number;
  abandonmentRate:number;
  confidence:number;
  scoreAdjustment:number;
}

export interface CompanyOutcomeEvent {
  eventId:string;
  companyId:string;
  offerId:string;
  intentFingerprint:string;
  stage:'IMPRESSION'|'OPENED'|'DRAFTED'|'APPROVED'|'PURCHASED'|'DELIVERED'|'RETURNED'|'CANCELLED';
  occurredAt:string;
  listedPrice?:number;
  comparableMedianPrice?:number;
  promisedAt?:string;
  deliveredAt?:string;
  explanationVariant?:string;
  convertedAfterExplanation?:boolean;
}

const clamp01=(n:number)=>Math.max(0,Math.min(1,n));

export function summarizeCompanyLearning(events:CompanyOutcomeEvent[]):Map<string,CompanyOutcomeSummary>{
  const grouped=new Map<string,CompanyOutcomeEvent[]>();
  for(const event of events){
    const list=grouped.get(event.companyId)??[];
    list.push(event);
    grouped.set(event.companyId,list);
  }

  const result=new Map<string,CompanyOutcomeSummary>();
  for(const [companyId,list] of grouped){
    const impressions=Math.max(1,list.filter(e=>e.stage==='IMPRESSION').length);
    const purchases=list.filter(e=>e.stage==='PURCHASED').length;
    const deliveries=list.filter(e=>e.stage==='DELIVERED');
    const returns=list.filter(e=>e.stage==='RETURNED').length;
    const cancels=list.filter(e=>e.stage==='CANCELLED').length;
    const drafts=list.filter(e=>e.stage==='DRAFTED').length;
    const approved=list.filter(e=>e.stage==='APPROVED').length;
    const abandoned=Math.max(0,drafts-approved);

    const onTimeDeliveries=deliveries.filter(e=>{
      if(!e.promisedAt||!e.deliveredAt) return false;
      const promised=new Date(e.promisedAt).getTime();
      const delivered=new Date(e.deliveredAt).getTime();
      return Number.isFinite(promised)&&Number.isFinite(delivered)&&delivered<=promised;
    }).length;

    const priceSamples=list.filter(e=>
      typeof e.listedPrice==='number'&&e.listedPrice>0&&
      typeof e.comparableMedianPrice==='number'&&e.comparableMedianPrice>0
    );
    const priceCompetitiveness=priceSamples.length
      ? priceSamples.reduce((sum,e)=>sum+clamp01((e.comparableMedianPrice!/e.listedPrice!)),0)/priceSamples.length
      : 0.5;

    const explanationEvents=list.filter(e=>e.explanationVariant);
    const explanationLift=explanationEvents.length
      ? explanationEvents.filter(e=>e.convertedAfterExplanation===true).length/explanationEvents.length
      : 0.5;

    const purchaseConversion=clamp01(purchases/impressions);
    const deliverySuccess=purchases?clamp01(deliveries.length/purchases):0;
    const cancellationRate=purchases?clamp01(cancels/purchases):0;
    const returnRate=purchases?clamp01(returns/purchases):0;
    const onTimeRate=deliveries.length?clamp01(onTimeDeliveries/deliveries.length):0;
    const abandonmentRate=drafts?clamp01(abandoned/drafts):0;
    const confidence=1-Math.exp(-list.length/40);

    const quality=
      purchaseConversion*.20+
      deliverySuccess*.20+
      onTimeRate*.15+
      priceCompetitiveness*.15+
      explanationLift*.10+
      (1-returnRate)*.10+
      (1-cancellationRate)*.05+
      (1-abandonmentRate)*.05;

    const adjustment=(quality-.5)*16*confidence;

    result.set(companyId,{
      companyId,
      observations:list.length,
      purchaseConversion:Number(purchaseConversion.toFixed(3)),
      deliverySuccess:Number(deliverySuccess.toFixed(3)),
      cancellationRate:Number(cancellationRate.toFixed(3)),
      returnRate:Number(returnRate.toFixed(3)),
      onTimeRate:Number(onTimeRate.toFixed(3)),
      priceCompetitiveness:Number(priceCompetitiveness.toFixed(3)),
      explanationLift:Number(explanationLift.toFixed(3)),
      abandonmentRate:Number(abandonmentRate.toFixed(3)),
      confidence:Number(confidence.toFixed(3)),
      scoreAdjustment:Number(adjustment.toFixed(2))
    });
  }

  return result;
}

export function applyCompanyAdjustment(baseScore:number,summary:CompanyOutcomeSummary|undefined){
  if(!summary) return {score:baseScore,adjustment:0,reasons:['cold-start company']};
  const score=Math.max(0,Math.min(100,Math.round(baseScore+summary.scoreAdjustment)));
  const reasons=[
    `${summary.observations} company outcome observations`,
    `${Math.round(summary.onTimeRate*100)}% observed on-time fulfillment`,
    `${Math.round(summary.returnRate*100)}% observed return rate`,
    `${Math.round(summary.abandonmentRate*100)}% draft abandonment`,
    `${Math.round(summary.priceCompetitiveness*100)} price competitiveness index`
  ];
  return {score,adjustment:summary.scoreAdjustment,reasons};
}

export interface ExplanationBanditSummary {
  variant:string;
  shown:number;
  converted:number;
  conversionRate:number;
  confidence:number;
}

export function summarizeExplanationVariants(events:CompanyOutcomeEvent[]):ExplanationBanditSummary[]{
  const map=new Map<string,{shown:number;converted:number}>();
  for(const event of events){
    if(!event.explanationVariant) continue;
    const current=map.get(event.explanationVariant)??{shown:0,converted:0};
    current.shown++;
    if(event.convertedAfterExplanation) current.converted++;
    map.set(event.explanationVariant,current);
  }
  return [...map.entries()].map(([variant,value])=>({
    variant,
    shown:value.shown,
    converted:value.converted,
    conversionRate:value.shown?Number((value.converted/value.shown).toFixed(3)):0,
    confidence:Number((1-Math.exp(-value.shown/25)).toFixed(3))
  })).sort((a,b)=>b.conversionRate*b.confidence-a.conversionRate*a.confidence);
}
