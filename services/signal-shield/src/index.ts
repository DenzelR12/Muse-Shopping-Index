import { authorize, type ActorContext, type Capability } from '@gift-signal/policy';
export type { Capability } from '@gift-signal/policy';
export interface RiskInput {actor:ActorContext;capability:Capability;amount?:number;velocity1h?:number;deviceNovel?:boolean;recipientConcentration?:number}
export function evaluateRisk(i:RiskInput){
  let score=i.actor.riskScore ?? 0;
  if((i.amount??0)>1000) score+=15;
  if((i.velocity1h??0)>5) score+=20;
  if(i.deviceNovel) score+=10;
  if((i.recipientConcentration??0)>.8) score+=15;
  const auth=authorize({...i.actor,riskScore:score},i.capability);
  return {score:Math.min(100,score),decision:auth.allowed?'ALLOW':'DENY',reason:auth.reason};
}
