import {issueApprovalToken,type SignedDraftEnvelope} from '@gift-signal/zero-trust';
import type {ConnectorActionDraft,CustomerConnection} from './business-connectors.js';
import type {SecurityAuditSink} from './business-security-audit.js';

export interface VerifiedUserIdentity {
  subjectId:string;
  sessionId:string;
  authenticatedAt:string;
  assurance:'MFA'|'PASSKEY'|'OAUTH_VERIFIED';
}

export interface ApprovalDraftReader {
  get(draftId:string):Promise<SignedDraftEnvelope<ConnectorActionDraft>|null>;
}

export interface ApprovalConnectionReader {
  resolve(connectionId:string):Promise<CustomerConnection|null>;
}

export class HumanApprovalIssuer {
  constructor(
    private readonly drafts:ApprovalDraftReader,
    private readonly connections:ApprovalConnectionReader,
    private readonly approvalSigningSecret:string,
    private readonly maxAgeMs=10*60*1000,
    private readonly audit?:SecurityAuditSink
  ){}

  async issue(args:{
    identity:VerifiedUserIdentity;
    connectionId:string;
    draftId:string;
    displayedDraftHash:string;
    approved:true;
    paymentAuthorizationReference?:string;
    now?:Date;
  }){
    const now=args.now??new Date();
    const authenticatedAt=new Date(args.identity.authenticatedAt).getTime();
    if(!Number.isFinite(authenticatedAt)||now.getTime()-authenticatedAt>this.maxAgeMs) throw new Error('user_reauthentication_required');

    const connection=await this.connections.resolve(args.connectionId);
    if(!connection) throw new Error('connection_not_found');
    if(connection.subjectId!==args.identity.subjectId) throw new Error('approval_identity_mismatch');
    if(connection.revokedAt) throw new Error('connection_revoked');
    if(connection.expiresAt&&new Date(connection.expiresAt).getTime()<=now.getTime()) throw new Error('connection_expired');

    const envelope=await this.drafts.get(args.draftId);
    if(!envelope) throw new Error('draft_not_found');
    if(envelope.payloadHash!==args.displayedDraftHash) throw new Error('displayed_draft_hash_mismatch');
    const draft=envelope.payload;
    if(draft.connectionId!==args.connectionId||draft.companyId!==connection.companyId) throw new Error('draft_scope_mismatch');
    if(new Date(draft.expiresAt).getTime()<=now.getTime()) throw new Error('draft_expired');

    const expiresAt=new Date(Math.min(new Date(draft.expiresAt).getTime(),now.getTime()+this.maxAgeMs)).toISOString();
    const token=issueApprovalToken({
      subjectId:connection.subjectId,
      companyId:connection.companyId,
      connectionId:connection.connectionId,
      draftId:draft.draftId,
      draftHash:envelope.payloadHash,
      amount:draft.total,
      currency:draft.currency,
      ...(args.paymentAuthorizationReference?{paymentAuthorizationReference:args.paymentAuthorizationReference}:{}),
      expiresAt
    },this.approvalSigningSecret,now.toISOString());
    await this.audit?.publish(connection.companyId,'approval_issued',{
      draftId:draft.draftId,
      connectionId:connection.connectionId,
      subjectId:connection.subjectId,
      draftHash:envelope.payloadHash,
      amount:draft.total,
      currency:draft.currency,
      ...(args.paymentAuthorizationReference?{paymentAuthorizationReference:args.paymentAuthorizationReference}:{}),
      expiresAt
    },{actorId:connection.subjectId,correlationId:draft.draftId,at:now.toISOString()});
    return token;
  }
}
