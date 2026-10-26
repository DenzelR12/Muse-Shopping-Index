import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {ReplayStore} from '@gift-signal/zero-trust';
export interface LinkClaims {purpose:string;eventId:string;capability:string;exp:number;iat:number;jti:string;rev:number}
const enc=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString('base64url');
export function issueSignedLink(baseUrl:string,claims:Omit<LinkClaims,'iat'|'jti'>,secret:string){
  const payload:LinkClaims={...claims,iat:Math.floor(Date.now()/1000),jti:randomUUID()};
  const body=enc(payload);const sig=createHmac('sha256',secret).update(body).digest('base64url');
  return `${baseUrl}?t=${body}.${sig}`;
}
export function verifySignedLink(token:string,secret:string,currentRev:number){
  const [body,sig]=token.split('.'); if(!body||!sig) return {ok:false,reason:'malformed'} as const;
  const expected=createHmac('sha256',secret).update(body).digest('base64url');
  const a=Buffer.from(sig),b=Buffer.from(expected); if(a.length!==b.length||!timingSafeEqual(a,b)) return {ok:false,reason:'bad_signature'} as const;
  const claims=JSON.parse(Buffer.from(body,'base64url').toString()) as LinkClaims;
  const now=Math.floor(Date.now()/1000); if(claims.exp<now) return {ok:false,reason:'expired'} as const;
  if(claims.rev!==currentRev) return {ok:false,reason:'revoked'} as const;
  return {ok:true,claims} as const;
}

export async function verifyAndConsumeSignedLink(token:string,secret:string,currentRev:number,replay:ReplayStore){
  const verified=verifySignedLink(token,secret,currentRev);
  if(!verified.ok) return verified;
  const expiresAt=new Date(verified.claims.exp*1000).toISOString();
  if(!await replay.consumeOnce('link:'+verified.claims.jti,expiresAt)) return {ok:false,reason:'replayed'} as const;
  return verified;
}
