import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';

export interface AuditEvent {
  id:string;
  type:string;
  at:string;
  actorId?:string;
  correlationId?:string;
  payload:Record<string,unknown>;
}

export interface AuditRecord extends AuditEvent {
  sequence:number;
  previousHash:string;
  eventHash:string;
  signature:string;
}

function stable(value:unknown):string{
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  const obj=value as Record<string,unknown>;
  return '{'+Object.keys(obj).sort().map(key=>JSON.stringify(key)+':'+stable(obj[key])).join(',')+'}';
}

export function audit(type:string,payload:Record<string,unknown>,meta:Partial<AuditEvent>={}):AuditEvent{
  return {id:meta.id??randomUUID(),type,at:meta.at??new Date().toISOString(),actorId:meta.actorId,correlationId:meta.correlationId,payload};
}

function body(record:Omit<AuditRecord,'eventHash'|'signature'>){
  return stable(record);
}

export function appendAuditRecord(args:{
  event:AuditEvent;
  sequence:number;
  previousHash:string;
  signingSecret:string;
}):AuditRecord{
  if(!args.signingSecret) throw new Error('audit_signing_secret_required');
  const base={...args.event,sequence:args.sequence,previousHash:args.previousHash};
  const eventHash=createHash('sha256').update(body(base)).digest('hex');
  const signature=createHmac('sha256',args.signingSecret).update(eventHash).digest('hex');
  return {...base,eventHash,signature};
}

export function verifyAuditRecord(record:AuditRecord,signingSecret:string){
  const {eventHash,signature,...base}=record;
  const expectedHash=createHash('sha256').update(body(base)).digest('hex');
  if(expectedHash!==eventHash) return {ok:false,reason:'audit_hash_mismatch'} as const;
  const expectedSig=createHmac('sha256',signingSecret).update(eventHash).digest('hex');
  const a=Buffer.from(signature,'hex'); const b=Buffer.from(expectedSig,'hex');
  if(a.length!==b.length||!timingSafeEqual(a,b)) return {ok:false,reason:'audit_signature_mismatch'} as const;
  return {ok:true} as const;
}

export function verifyAuditChain(records:AuditRecord[],signingSecret:string){
  let previous='GENESIS';
  let expectedSequence=1;
  for(const record of records){
    if(record.sequence!==expectedSequence) return {ok:false,reason:'audit_sequence_gap',recordId:record.id} as const;
    if(record.previousHash!==previous) return {ok:false,reason:'audit_chain_break',recordId:record.id} as const;
    const verified=verifyAuditRecord(record,signingSecret);
    if(!verified.ok) return {...verified,recordId:record.id} as const;
    previous=record.eventHash;
    expectedSequence++;
  }
  return {ok:true,headHash:previous,count:records.length} as const;
}
