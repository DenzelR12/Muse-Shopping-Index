import type { BundlePlan, GiftContext, ProductCandidate, Recommendation } from '@gift-signal/schemas';

const clamp=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,n));

export interface RecommendationEligibility {
  eligible:boolean;
  missing:string[];
}

/**
 * A concierge may describe only products whose customer-facing identity has
 * been verified. This is deterministic input validation, not an LLM judgment.
 */
export function recommendationEligibility(product:ProductCandidate):RecommendationEligibility {
  const missing:string[]=[];
  if(!product.evidenceVerified) missing.push('verified source evidence');
  if(product.signalVerified!==true) missing.push('Signal Verified collection membership');
  if(!product.title.trim()) missing.push('title');
  if(!product.productCategory?.trim()) missing.push('product category');
  if(!product.productType?.trim()) missing.push('product type');
  if(!product.variantId?.trim()) missing.push('purchasable variant');
  if(!Number.isFinite(product.price) || product.price<0) missing.push('price');
  if(!product.images?.some(image=>image.url.startsWith('https://')&&image.alt.trim())) missing.push('accessible product image');
  if(!product.inStock) missing.push('availability');
  return {eligible:missing.length===0,missing};
}
function overlapScore(need:string[]|undefined, have:string[]){
  if(!need?.length) return 50;
  const a=need.map(x=>x.toLowerCase()); const b=have.map(x=>x.toLowerCase());
  return 100 * a.filter(x=>b.some(y=>y.includes(x)||x.includes(y))).length / a.length;
}
export function scoreCandidate(ctx:GiftContext,p:ProductCandidate){
  const interest=overlapScore(ctx.interests,[...p.semanticIntents,...p.useCases,...p.recipientFit]);
  const occasion=ctx.occasion?overlapScore([ctx.occasion],p.occasionFit):60;
  const delivery=p.deliveryConfidence ?? 50;
  const semantic=p.semanticCompleteness ?? 50;
  const stock=p.inStock?100:0;
  const budgetMax=ctx.budgetMax ?? Number.POSITIVE_INFINITY;
  const budget=p.price<=budgetMax?100:Math.max(0,100-(p.price-budgetMax));
  return clamp(interest*.28+occasion*.18+delivery*.18+semantic*.18+stock*.12+budget*.06);
}
export function recommend(ctx:GiftContext,candidates:ProductCandidate[]):Recommendation[]{
  const ranked=candidates.filter(product=>recommendationEligibility(product).eligible).map(p=>({p,score:scoreCandidate(ctx,p)})).sort((a,b)=>b.score-a.score).slice(0,3);
  const labels:Recommendation['label'][]=['BEST_SIGNAL','SMARTER_VALUE','LET_THEM_CHOOSE'];
  return ranked.map((x,i)=>({rank:i+1,label:labels[i],product:x.p,score:Math.round(x.score),why:[
    ctx.occasion && x.p.occasionFit.some(o=>o.toLowerCase()===ctx.occasion!.toLowerCase())
      ? `Why this fits: catalog occasion match for ${ctx.occasion}` : 'Why this fits: compare the verified product details with the recipient’s preferences',
    x.p.deliveryConfidence===undefined ? 'Delivery has not been verified' : `${x.p.deliveryConfidence}% catalog delivery confidence`,
    x.p.inStock?'Currently in stock':'Inventory needs review'
  ]}));
}
export function buildBundle(ctx:GiftContext,candidates:ProductCandidate[]):BundlePlan[]{
  const target=ctx.budgetMax ?? 250;
  const valid=candidates.filter(x=>recommendationEligibility(x).eligible&&x.price<=target).sort((a,b)=>scoreCandidate(ctx,b)-scoreCandidate(ctx,a));
  const greedy=(cap:number)=>{const out:ProductCandidate[]=[];let t=0;for(const p of valid){if(t+p.price<=cap&&out.length<5){out.push(p);t+=p.price;}}return out};
  return [
    ['BEST_COMPLETE_CART',1],['SMARTER_VALUE_CART',0.8],['UPGRADE_THE_SIGNAL',1.1]
  ].map(([mode,m])=>{const items=greedy(target*Number(m));const total=items.reduce((s,p)=>s+p.price,0);return {items,total,targetBudget:target,delta:target-total,mode:mode as BundlePlan['mode'],whyTogether:['Items cover distinct bundle roles','Cart stays close to the requested budget','Selections prioritize semantic fit and in-stock availability']};});
}
