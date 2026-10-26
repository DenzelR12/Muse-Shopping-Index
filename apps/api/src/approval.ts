import type {IncomingMessage} from 'node:http';
import {
  HumanApprovalIssuer,
  OidcIdentityVerifier,
  PostgresZeroTrustAuthority,
  PostgresSecurityAuditSink,
  bearerToken,
  type VerifiedUserIdentity
} from '@gift-signal/mcp-gateway';

let authority:PostgresZeroTrustAuthority|null=null;
let audit:PostgresSecurityAuditSink|null=null;
let verifier:OidcIdentityVerifier|null=null;
let issuer:HumanApprovalIssuer|null=null;

function services(){
  if(issuer&&verifier) return {issuer,verifier};
  const databaseUrl=process.env.DATABASE_URL;
  const approvalSecret=process.env.APPROVAL_SIGNING_SECRET;
  const auditSecret=process.env.AUDIT_HASH_SECRET;
  const issuerUrl=process.env.OIDC_ISSUER;
  const audience=process.env.OIDC_AUDIENCE;
  const jwksUrl=process.env.OIDC_JWKS_URL;
  if(!databaseUrl||!approvalSecret||!auditSecret||!issuerUrl||!audience||!jwksUrl){
    throw new Error('approval_service_not_configured');
  }
  authority=PostgresZeroTrustAuthority.fromUrl(databaseUrl);
  audit=PostgresSecurityAuditSink.fromUrl(databaseUrl,auditSecret);
  verifier=new OidcIdentityVerifier({
    issuer:issuerUrl,
    audience,
    jwksUrl,
    maxAuthenticationAgeSeconds:600,
    ...(process.env.SHOP_OIDC_USER_ID_CLAIM?.trim()?{shopUserIdClaim:process.env.SHOP_OIDC_USER_ID_CLAIM.trim()}:{} )
  });
  issuer=new HumanApprovalIssuer(authority,authority,approvalSecret,10*60*1000,audit);
  return {issuer,verifier};
}

export async function verifyHumanIdentity(req:Pick<IncomingMessage,'headers'>){
  const auth=Array.isArray(req.headers.authorization)?req.headers.authorization[0]:req.headers.authorization;
  const token=bearerToken(auth);
  if(!token) throw new Error('identity_token_required');
  const identityVerifier=services().verifier;
  try{
    return await identityVerifier.verifyBearerToken(token);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(/^identity_(subject_required|auth_time_required|reauthentication_required)$/.test(message)) throw error;
    throw new Error('identity_token_invalid');
  }
}

export interface HumanApprovalRequest {
  connectionId?:unknown;
  draftId?:unknown;
  displayedDraftHash?:unknown;
  approved?:unknown;
}

export async function issueVerifiedHumanApproval(args:{
  identity:VerifiedUserIdentity;
  body:HumanApprovalRequest;
  issuer:Pick<HumanApprovalIssuer,'issue'>;
  // Only the Muse route supplies this server-owned resolver. Generic connector
  // approvals have no dependency on a consumer payment store or payment rail.
  resolveSavedPayment?:(subjectId:string)=>Promise<{reference:string}|null>;
}){
  const {body,identity}=args;
  if(body.approved!==true) throw new Error('explicit_approval_required');
  const connectionId=typeof body.connectionId==='string'?body.connectionId.trim():'';
  const draftId=typeof body.draftId==='string'?body.draftId.trim():'';
  const displayedDraftHash=typeof body.displayedDraftHash==='string'?body.displayedDraftHash.trim():'';
  if(!connectionId||!draftId||!/^[a-f0-9]{64}$/i.test(displayedDraftHash)) throw new Error('invalid_approval_request');

  let paymentAuthorizationReference:string|undefined;
  if(args.resolveSavedPayment){
    const saved=await args.resolveSavedPayment(identity.subjectId);
    if(!saved?.reference?.trim()) throw new Error('consumer_commerce_enrollment_required');
    paymentAuthorizationReference=saved.reference;
  }
  const approvalToken=await args.issuer.issue({
    identity,
    connectionId,
    draftId,
    displayedDraftHash,
    approved:true,
    ...(paymentAuthorizationReference?{paymentAuthorizationReference}:{})
  });
  return {approvalToken,draftId,connectionId,expiresInSeconds:600};
}

export async function issueHumanApproval(req:Pick<IncomingMessage,'headers'>,body:HumanApprovalRequest,
  options?:{resolveSavedPayment:(subjectId:string)=>Promise<{reference:string}|null>}){
  const identity=await verifyHumanIdentity(req);
  return issueVerifiedHumanApproval({identity,body,issuer:services().issuer,...options});
}

export function approvalErrorStatus(message:string){
  if(/^(identity_(token_|subject_required$|auth_time_required$|reauthentication_required$)|user_reauthentication_required$|approval_identity_mismatch$)/.test(message)) return 401;
  if(/not_configured/.test(message)) return 503;
  if(/enrollment_required|reapproval|^approval_|mismatch|expired|revoked/.test(message)) return 409;
  return 400;
}

