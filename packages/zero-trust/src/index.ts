import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';

export interface ReplayStore {
  consumeOnce(key:string,expiresAt:string):Promise<boolean>;
}

export class InMemoryReplayStore implements ReplayStore {
  private readonly used=new Map<string,number>();
  async consumeOnce(key:string,expiresAt:string){
    if(this.used.has(key)) return false;
    const exp=new Date(expiresAt).getTime();
    if(!Number.isFinite(exp)) return false;
    this.used.set(key,exp);
    return true;
  }

  purgeExpired(now=new Date()){
    const current=now.getTime();
    for(const [key,exp] of this.used) if(exp<=current) this.used.delete(key);
  }
}

function stable(value:unknown):string{
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  const obj=value as Record<string,unknown>;
  return '{'+Object.keys(obj).sort().map(k=>JSON.stringify(k)+':'+stable(obj[k])).join(',')+'}';
}
const b64=(s:string)=>Buffer.from(s).toString('base64url');
const unb64=(s:string)=>Buffer.from(s,'base64url').toString('utf8');
const sign=(body:string,secret:string)=>createHmac('sha256',secret).update(body).digest('base64url');
const safeEq=(a:string,b:string)=>{
  const x=Buffer.from(a); const y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
};

export function digestObject(value:unknown){
  return createHash('sha256').update(stable(value)).digest('hex');
}

export interface SignedDraftEnvelope<T>{
  draftId:string;
  payload:T;
  payloadHash:string;
  issuedAt:string;
  expiresAt:string;
  signature:string;
}

export function signDraft<T extends {draftId:string;expiresAt:string}>(
  draft:T,
  secret:string,
  issuedAt=new Date().toISOString()
):SignedDraftEnvelope<T>{
  if(!secret) throw new Error('draft_signing_secret_required');
  const payloadHash=digestObject(draft);
  const body=stable({draftId:draft.draftId,payloadHash,issuedAt,expiresAt:draft.expiresAt});
  return {draftId:draft.draftId,payload:structuredClone(draft),payloadHash,issuedAt,expiresAt:draft.expiresAt,signature:sign(body,secret)};
}

export function verifyDraft<T extends {draftId:string;expiresAt:string}>(
  envelope:SignedDraftEnvelope<T>,
  secret:string,
  now=new Date()
){
  if(!secret) return {ok:false,reason:'missing_draft_signing_secret'} as const;
  if(new Date(envelope.expiresAt).getTime()<=now.getTime()) return {ok:false,reason:'draft_expired'} as const;
  if(digestObject(envelope.payload)!==envelope.payloadHash) return {ok:false,reason:'draft_payload_tampered'} as const;
  const body=stable({draftId:envelope.draftId,payloadHash:envelope.payloadHash,issuedAt:envelope.issuedAt,expiresAt:envelope.expiresAt});
  if(!safeEq(sign(body,secret),envelope.signature)) return {ok:false,reason:'invalid_draft_signature'} as const;
  return {ok:true,payload:structuredClone(envelope.payload),payloadHash:envelope.payloadHash} as const;
}

export interface ApprovalClaims {
  jti:string;
  subjectId:string;
  companyId:string;
  connectionId:string;
  draftId:string;
  draftHash:string;
  amount:number;
  currency:string;
  paymentAuthorizationReference?:string;
  action:'execute_action';
  issuedAt:string;
  expiresAt:string;
}

export function issueApprovalToken(
  claims:Omit<ApprovalClaims,'jti'|'issuedAt'|'action'>,
  secret:string,
  issuedAt=new Date().toISOString()
){
  if(!secret) throw new Error('approval_signing_secret_required');
  const full:ApprovalClaims={...claims,jti:randomUUID(),issuedAt,action:'execute_action'};
  const payload=b64(stable(full));
  return payload+'.'+sign(payload,secret);
}

export function verifyApproval(args:{
  token:string;
  secret:string;
  expected:{
    subjectId:string;companyId:string;connectionId:string;draftId:string;draftHash:string;amount:number;currency:string;paymentAuthorizationReference?:string;
  };
  now?:Date;
}){
  const [payload,sig]=args.token.split('.');
  if(!payload||!sig) return {ok:false,reason:'malformed_approval'} as const;
  if(!safeEq(sign(payload,args.secret),sig)) return {ok:false,reason:'invalid_approval_signature'} as const;
  let claims:ApprovalClaims;
  try{claims=JSON.parse(unb64(payload)) as ApprovalClaims;}catch{return {ok:false,reason:'invalid_approval_payload'} as const;}
  const now=args.now??new Date();
  if(new Date(claims.expiresAt).getTime()<=now.getTime()) return {ok:false,reason:'approval_expired'} as const;
  if(claims.action!=='execute_action') return {ok:false,reason:'approval_wrong_action'} as const;
  for(const field of ['subjectId','companyId','connectionId','draftId','draftHash','currency'] as const){
    if(claims[field]!==args.expected[field]) return {ok:false,reason:`approval_${field}_mismatch`} as const;
  }
  if(claims.amount!==args.expected.amount) return {ok:false,reason:'approval_amount_mismatch'} as const;
  if(args.expected.paymentAuthorizationReference!==undefined&&claims.paymentAuthorizationReference!==args.expected.paymentAuthorizationReference){
    return {ok:false,reason:'approval_payment_authorization_mismatch'} as const;
  }
  return {ok:true,claims} as const;
}

export async function verifyAndConsumeApproval(args:{
  token:string;
  secret:string;
  replay:ReplayStore;
  expected:{
    subjectId:string;companyId:string;connectionId:string;draftId:string;draftHash:string;amount:number;currency:string;paymentAuthorizationReference?:string;
  };
  now?:Date;
}){
  const verified=verifyApproval(args);
  if(!verified.ok) return verified;
  if(!await args.replay.consumeOnce('approval:'+verified.claims.jti,verified.claims.expiresAt)) return {ok:false,reason:'approval_replayed'} as const;
  return verified;
}

export async function consumeWebhookOnce(args:{provider:string;eventId:string;expiresAt:string;replay:ReplayStore}){
  return args.replay.consumeOnce(`webhook:${args.provider}:${args.eventId}`,args.expiresAt);
}
