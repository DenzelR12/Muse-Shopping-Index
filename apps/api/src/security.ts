import {randomUUID} from 'node:crypto';
export function apiSecurityHeaders(requestId=randomUUID()){
  return {
    'x-request-id':requestId,
    'x-content-type-options':'nosniff',
    'x-frame-options':'DENY',
    'referrer-policy':'no-referrer',
    'permissions-policy':'camera=(), microphone=(), geolocation=()',
    'content-security-policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'strict-transport-security':'max-age=31536000; includeSubDomains'
  };
}
export function requestClientKey(headers:Record<string,string|string[]|undefined>,remoteAddress?:string|null){
  const forwarded=headers['x-forwarded-for'];
  const raw=Array.isArray(forwarded)?forwarded[0]:forwarded;
  return raw?.split(',')[0]?.trim()||remoteAddress||'unknown';
}
