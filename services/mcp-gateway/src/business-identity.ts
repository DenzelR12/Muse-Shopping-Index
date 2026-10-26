import {createRemoteJWKSet,jwtVerify,type JWTPayload} from 'jose';
import type {VerifiedUserIdentity} from './business-approval.js';

export interface OidcIdentityConfig {
  issuer:string;
  audience:string;
  jwksUrl:string;
  maxAuthenticationAgeSeconds?:number;
  shopUserIdClaim?:string;
}

export interface VerifiedOidcIdentity extends VerifiedUserIdentity {
  issuer:string;
  audience:string|string[];
  tokenId?:string;
  shopUserPublicId?:string;
  email?:string;
}

export class OidcIdentityVerifier {
  private readonly jwks;
  constructor(private readonly config:OidcIdentityConfig){
    if(!config.issuer||!config.audience||!config.jwksUrl) throw new Error('oidc_config_required');
    this.jwks=createRemoteJWKSet(new URL(config.jwksUrl));
  }

  async verifyBearerToken(token:string,now=new Date()):Promise<VerifiedOidcIdentity>{
    if(!token) throw new Error('identity_token_required');
    const {payload}=await jwtVerify(token,this.jwks,{
      issuer:this.config.issuer,
      audience:this.config.audience,
      clockTolerance:5
    });
    return this.fromPayload(payload,now);
  }

  private fromPayload(payload:JWTPayload,now:Date):VerifiedOidcIdentity{
    if(!payload.sub) throw new Error('identity_subject_required');
    const authTime=typeof payload.auth_time==='number'?payload.auth_time:
      typeof payload.iat==='number'?payload.iat:undefined;
    if(!authTime) throw new Error('identity_auth_time_required');
    const maxAge=this.config.maxAuthenticationAgeSeconds??600;
    const ageSeconds=Math.floor(now.getTime()/1000)-authTime;
    if(ageSeconds<0||ageSeconds>maxAge) throw new Error('identity_reauthentication_required');

    const amr=Array.isArray(payload.amr)?payload.amr.map(String):[];
    const acr=typeof payload.acr==='string'?payload.acr:'';
    const assurance:VerifiedUserIdentity['assurance']=
      amr.some(value=>/webauthn|passkey|fido/i.test(value))?'PASSKEY':
      amr.some(value=>/mfa|otp|totp/i.test(value))||/mfa/i.test(acr)?'MFA':'OAUTH_VERIFIED';

    const shopClaim=this.config.shopUserIdClaim?.trim();
    const shopUserPublicId=shopClaim&&typeof payload[shopClaim]==='string'?String(payload[shopClaim]).trim():undefined;
    const verifiedEmail=payload.email_verified===true&&typeof payload.email==='string'&&payload.email.trim()?payload.email.trim().toLowerCase():undefined;
    return {
      subjectId:payload.sub,
      sessionId:typeof payload.sid==='string'?payload.sid:(payload.jti??'oidc-session'),
      authenticatedAt:new Date(authTime*1000).toISOString(),
      assurance,
      issuer:String(payload.iss??this.config.issuer),
      audience:payload.aud??this.config.audience,
      tokenId:payload.jti,
      ...(shopUserPublicId?{shopUserPublicId}:{}),
      ...(verifiedEmail?{email:verifiedEmail}:{})
    };
  }
}

export function bearerToken(authorization:string|undefined){
  if(!authorization) return null;
  const match=authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim()||null;
}
