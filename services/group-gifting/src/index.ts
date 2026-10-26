import { randomUUID } from 'node:crypto';
import type { GroupGiftEvent } from '@gift-signal/schemas';
export function createGroupGift(input:Omit<GroupGiftEvent,'eventId'|'fundedAmount'|'status'|'revocationVersion'>):GroupGiftEvent{
  return {...input,eventId:randomUUID(),fundedAmount:0,status:'DRAFT',revocationVersion:1};
}
export function applyContribution(e:GroupGiftEvent,amount:number){
  if(e.status!=='OPEN') throw new Error('Event not open'); if(amount<=0) throw new Error('Invalid amount');
  const funded=Math.min(e.targetAmount,e.fundedAmount+amount);
  return {...e,fundedAmount:funded,status:funded>=e.targetAmount?'FUNDED':'OPEN'} as GroupGiftEvent;
}
