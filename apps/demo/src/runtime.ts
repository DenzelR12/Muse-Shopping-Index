import {randomUUID} from 'node:crypto';

export interface RuntimeReadiness {
  mode:'demo'|'production';
  persistentState:boolean;
  museConfigured:boolean;
  paymentConfigured:boolean;
  zeroTrustConfigured:boolean;
  identityProviderConfigured:boolean;
  productionReady:boolean;
  missing:string[];
}

export interface ExpiringDraft {
  status:'REVIEW'|'APPROVED'|'CONFIRMED';
  createdAt:string;
  expiresAt:string;
}

export function runtimeReadiness(env:NodeJS.ProcessEnv=process.env):RuntimeReadiness{
  const mode=env.APP_MODE==='production'?'production':'demo';
  const persistentState=Boolean(env.DATABASE_URL);
  const museConfigured=Boolean(env.META_MODEL_API_KEY&&env.META_MODEL_API_BASE_URL&&env.META_MUSE_MODEL);
  const paymentConfigured=Boolean(env.STRIPE_SECRET_KEY&&env.STRIPE_WEBHOOK_SECRET);
  const zeroTrustConfigured=Boolean(env.DRAFT_SIGNING_SECRET&&env.APPROVAL_SIGNING_SECRET&&env.AUDIT_HASH_SECRET);
  const identityProviderConfigured=Boolean(env.OIDC_ISSUER&&env.OIDC_AUDIENCE&&env.OIDC_JWKS_URL);
  const missing:string[]=[];
  if(!persistentState) missing.push('persistent_state');
  if(!museConfigured) missing.push('muse');
  if(!paymentConfigured) missing.push('payment');
  if(!zeroTrustConfigured) missing.push('zero_trust_secrets');
  if(!identityProviderConfigured) missing.push('identity_provider');
  return {
    mode,
    persistentState,
    museConfigured,
    paymentConfigured,
    zeroTrustConfigured,
    identityProviderConfigured,
    productionReady:mode==='production'&&missing.length===0,
    missing
  };
}

export function securityHeaders(requestId=randomUUID()){
  return {
    'x-request-id':requestId,
    'x-content-type-options':'nosniff',
    'x-frame-options':'DENY',
    'referrer-policy':'no-referrer',
    'permissions-policy':'camera=(), microphone=(), geolocation=()',
    'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'strict-transport-security':'max-age=31536000; includeSubDomains'
  };
}

export class FixedWindowRateLimiter {
  private readonly buckets=new Map<string,{count:number;resetAt:number}>();
  constructor(
    private readonly limit:number,
    private readonly windowMs:number
  ){}

  check(key:string,now=Date.now()){
    const current=this.buckets.get(key);
    if(!current||current.resetAt<=now){
      const next={count:1,resetAt:now+this.windowMs};
      this.buckets.set(key,next);
      return {allowed:true,remaining:Math.max(0,this.limit-1),resetAt:next.resetAt};
    }
    current.count++;
    const allowed=current.count<=this.limit;
    return {allowed,remaining:Math.max(0,this.limit-current.count),resetAt:current.resetAt};
  }

  cleanup(now=Date.now()){
    for(const [key,bucket] of this.buckets){
      if(bucket.resetAt<=now) this.buckets.delete(key);
    }
  }
}

export function draftExpiry(createdAt:string,ttlMs:number){
  const created=new Date(createdAt).getTime();
  if(!Number.isFinite(created)) throw new Error('invalid_draft_created_at');
  return new Date(created+ttlMs).toISOString();
}

export function assertDraftMayApprove(draft:ExpiringDraft,now=new Date()){
  if(draft.status==='CONFIRMED') throw new Error('draft_already_confirmed');
  if(new Date(draft.expiresAt).getTime()<=now.getTime()) throw new Error('draft_expired');
  return true;
}

export function clientKey(headers:Record<string,string|string[]|undefined>,socketAddress?:string|null){
  const forwarded=headers['x-forwarded-for'];
  const raw=Array.isArray(forwarded)?forwarded[0]:forwarded;
  const first=raw?.split(',')[0]?.trim();
  return first||socketAddress||'unknown';
}
