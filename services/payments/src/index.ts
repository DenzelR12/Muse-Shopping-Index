export type PaymentState='DRAFT'|'PENDING'|'AUTHORIZED'|'SUCCEEDED'|'FAILED'|'REFUNDED'|'DISPUTED';
export interface PaymentRecord {id:string;eventId:string;amount:number;currency:string;processorRef?:string;state:PaymentState;idempotencyKey:string}
export function transition(p:PaymentRecord,next:PaymentState){
  const allowed:Record<PaymentState,PaymentState[]>={DRAFT:['PENDING'],PENDING:['AUTHORIZED','SUCCEEDED','FAILED'],AUTHORIZED:['SUCCEEDED','FAILED'],SUCCEEDED:['REFUNDED','DISPUTED'],FAILED:[],REFUNDED:[],DISPUTED:[]};
  if(!allowed[p.state].includes(next)) throw new Error(`Invalid transition ${p.state}->${next}`);
  return {...p,state:next};
}

export * from './stripe.js';
