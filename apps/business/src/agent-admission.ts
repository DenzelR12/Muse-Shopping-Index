import type { ProductCandidate } from '@gift-signal/schemas';
import { signalStandardReadiness } from './signal-standard.js';

export interface AgentAdmissionOptions {
  now?: Date;
  maxSourceAgeHours?: number;
  minimumSemanticCompleteness?: number;
}

export interface AgentAdmissionResult {
  productId:string;
  eligible:boolean;
  reasons:string[];
}

export function agentAdmissionReadiness(
  product:ProductCandidate,
  options:AgentAdmissionOptions={}
):AgentAdmissionResult {
  const reasons:string[]=[];
  const now=options.now??new Date();
  const maxSourceAgeHours=options.maxSourceAgeHours??48;
  const minimumSemanticCompleteness=options.minimumSemanticCompleteness??80;

  if(product.signalVerified!==true) reasons.push('Signal Verified collection membership required');
  if(!product.inStock) reasons.push('current inventory required');

  const standard=signalStandardReadiness(product);
  if(!standard.eligible) reasons.push(...standard.reasons);

  const sourceTime=product.sourceUpdatedAt ? Date.parse(product.sourceUpdatedAt) : Number.NaN;
  if(!Number.isFinite(sourceTime)) {
    reasons.push('valid source timestamp required');
  } else {
    const ageHours=(now.getTime()-sourceTime)/3_600_000;
    if(ageHours<0) reasons.push('source timestamp cannot be in the future');
    if(ageHours>maxSourceAgeHours) reasons.push(`catalog evidence older than ${maxSourceAgeHours} hours`);
  }

  if((product.semanticCompleteness??0)<minimumSemanticCompleteness) {
    reasons.push(`semantic completeness below ${minimumSemanticCompleteness}`);
  }
  if(product.semanticIntents.length===0) reasons.push('semantic intents required');
  if(product.useCases.length===0) reasons.push('use cases required');

  return {productId:product.productId,eligible:reasons.length===0,reasons:[...new Set(reasons)]};
}

export interface AgentAdmissionDashboard {
  total:number;
  eligible:number;
  held:number;
  reviewQueue:Array<{productId:string;title:string;reasons:string[]}>;
}

export function agentAdmissionDashboard(
  products:ProductCandidate[],
  options:AgentAdmissionOptions={}
):AgentAdmissionDashboard {
  const dashboard:AgentAdmissionDashboard={total:products.length,eligible:0,held:0,reviewQueue:[]};
  for(const product of products){
    const result=agentAdmissionReadiness(product,options);
    if(result.eligible){
      dashboard.eligible++;
    }else{
      dashboard.held++;
      dashboard.reviewQueue.push({productId:product.productId,title:product.title,reasons:result.reasons});
    }
  }
  return dashboard;
}
