import {
  signDraft,
  verifyDraft,
  verifyAndConsumeApproval,
  type ReplayStore,
  type SignedDraftEnvelope
} from '@gift-signal/zero-trust';
import {
  validateConnection,
  type CompanyConnectorManifest,
  type CompanyConnectorAdapter,
  type ConnectorActionDraft,
  type CustomerConnection,
  type OfferSearchRequest
} from './business-connectors.js';
import type {SecurityAuditSink} from './business-security-audit.js';

export interface ZeroTrustConnectorAdapter extends CompanyConnectorAdapter {
  idempotentCommit:true;
  revalidate(draft:ConnectorActionDraft,connection:CustomerConnection):Promise<ConnectorActionDraft>;
}

export interface ConnectionAuthority {
  resolve(connectionId:string):Promise<CustomerConnection|null>;
}

export interface DraftAuthority {
  save(envelope:SignedDraftEnvelope<ConnectorActionDraft>):Promise<void>;
  get(draftId:string):Promise<SignedDraftEnvelope<ConnectorActionDraft>|null>;
  claimExecution(draftId:string):Promise<boolean>;
}

export class MemoryConnectionAuthority implements ConnectionAuthority {
  private readonly values=new Map<string,CustomerConnection>();
  put(connection:CustomerConnection){this.values.set(connection.connectionId,structuredClone(connection));}
  async resolve(connectionId:string){const value=this.values.get(connectionId);return value?structuredClone(value):null;}
}

export class MemoryDraftAuthority implements DraftAuthority {
  private readonly values=new Map<string,SignedDraftEnvelope<ConnectorActionDraft>>();
  private readonly claimed=new Set<string>();
  async save(envelope:SignedDraftEnvelope<ConnectorActionDraft>){this.values.set(envelope.draftId,structuredClone(envelope));}
  async get(draftId:string){const value=this.values.get(draftId);return value?structuredClone(value):null;}
  async claimExecution(draftId:string){
    if(this.claimed.has(draftId)) return false;
    if(!this.values.has(draftId)) return false;
    this.claimed.add(draftId);
    return true;
  }
}

export class ZeroTrustConnectorRegistry {
  private readonly manifests=new Map<string,CompanyConnectorManifest>();
  private readonly adapters=new Map<string,ZeroTrustConnectorAdapter>();
  register(manifest:CompanyConnectorManifest,adapter:ZeroTrustConnectorAdapter){
    if(this.manifests.has(manifest.companyId)) throw new Error('connector_company_already_registered');
    this.manifests.set(manifest.companyId,structuredClone(manifest));
    this.adapters.set(manifest.companyId,adapter);
  }
  get(companyId:string){
    const manifest=this.manifests.get(companyId);
    const adapter=this.adapters.get(companyId);
    if(!manifest||!adapter) throw new Error('unknown_company_connector');
    return {manifest:structuredClone(manifest),adapter};
  }
}

export class ZeroTrustConnectorRuntime {
  constructor(
    private readonly registry:ZeroTrustConnectorRegistry,
    private readonly connections:ConnectionAuthority,
    private readonly drafts:DraftAuthority,
    private readonly replay:ReplayStore,
    private readonly secrets:{draftSigningSecret:string;approvalSigningSecret:string},
    private readonly audit?:SecurityAuditSink
  ){}

  private async connectionFor(companyId:string,connectionId:string,action:'search_offers'|'create_action_draft'|'execute_action',now=new Date()){
    const connection=await this.connections.resolve(connectionId);
    if(!connection) throw new Error('connection_not_found');
    if(connection.companyId!==companyId) throw new Error('connection_company_mismatch');
    const {manifest,adapter}=this.registry.get(companyId);
    const gate=validateConnection(manifest,connection,action,now);
    if(!gate.allowed) throw new Error(gate.reason);
    return {connection,manifest,adapter,gate};
  }

  async search(companyId:string,connectionId:string,request:OfferSearchRequest,now=new Date()){
    const {connection,manifest,adapter,gate}=await this.connectionFor(companyId,connectionId,'search_offers',now);
    const offers=await adapter.search(request,connection);
    return {company:manifest,offers,gate};
  }

  async createDraft(companyId:string,connectionId:string,args:{offerIds:string[];quantity:number;kind:'PURCHASE'|'BOOKING'},now=new Date()){
    const {connection,manifest,adapter,gate}=await this.connectionFor(companyId,connectionId,'create_action_draft',now);
    if(!args.offerIds.length) throw new Error('at_least_one_offer_required');
    if(!Number.isInteger(args.quantity)||args.quantity<1) throw new Error('quantity_must_be_positive_integer');
    const draft=await adapter.createDraft({...args,connection});
    if(draft.companyId!==companyId||draft.connectionId!==connection.connectionId) throw new Error('provider_returned_mismatched_draft');
    if(new Date(draft.expiresAt).getTime()<=now.getTime()) throw new Error('provider_returned_expired_draft');
    const envelope=signDraft(draft,this.secrets.draftSigningSecret,now.toISOString());
    await this.drafts.save(envelope);
    await this.audit?.publish(companyId,'draft_signed',{
      draftId:draft.draftId,
      connectionId,
      subjectId:connection.subjectId,
      draftHash:envelope.payloadHash,
      amount:draft.total,
      currency:draft.currency,
      expiresAt:draft.expiresAt
    },{actorId:connection.subjectId,correlationId:draft.draftId,at:now.toISOString()});
    return {
      company:manifest,
      draft:{
        draftId:draft.draftId,
        companyId:draft.companyId,
        connectionId:draft.connectionId,
        kind:draft.kind,
        offerIds:[...draft.offerIds],
        quantity:draft.quantity,
        total:draft.total,
        currency:draft.currency,
        summary:draft.summary,
        createdAt:draft.createdAt,
        expiresAt:draft.expiresAt,
        approvalRequired:true,
        liveRevalidationRequired:true
      },
      gate
    };
  }

  async execute(companyId:string,connectionId:string,args:{draftId:string;approvalToken:string},now=new Date()){
    const {connection,adapter}=await this.connectionFor(companyId,connectionId,'execute_action',now);
    const envelope=await this.drafts.get(args.draftId);
    if(!envelope) throw new Error('draft_not_found');
    const verified=verifyDraft(envelope,this.secrets.draftSigningSecret,now);
    if(!verified.ok) throw new Error(verified.reason);
    const draft=verified.payload;
    if(draft.companyId!==companyId||draft.connectionId!==connectionId) throw new Error('draft_scope_mismatch');

    const revalidated=await adapter.revalidate(draft,connection);
    const revalidatedEnvelope=signDraft(revalidated,this.secrets.draftSigningSecret,envelope.issuedAt);
    if(revalidatedEnvelope.payloadHash!==verified.payloadHash){
      throw new Error('provider_state_changed_reapproval_required');
    }

    const approval=await verifyAndConsumeApproval({
      token:args.approvalToken,
      secret:this.secrets.approvalSigningSecret,
      replay:this.replay,
      expected:{
        subjectId:connection.subjectId,
        companyId,
        connectionId,
        draftId:draft.draftId,
        draftHash:verified.payloadHash,
        amount:draft.total,
        currency:draft.currency
      },
      now
    });
    if(!approval.ok) throw new Error(approval.reason);

    if(!adapter.idempotentCommit) throw new Error('provider_commit_not_idempotent');
    if(!await this.drafts.claimExecution(draft.draftId)) throw new Error('draft_already_executing_or_executed');
    await this.audit?.publish(companyId,'draft_execution_claimed',{
      draftId:draft.draftId,
      connectionId,
      approvalJti:approval.claims.jti,
      draftHash:verified.payloadHash
    },{actorId:connection.subjectId,correlationId:draft.draftId,at:now.toISOString()});

    const execution=await adapter.execute({
      draft,
      connection,
      approval:{approved:true,approvedAt:approval.claims.issuedAt,approvalId:approval.claims.jti}
    });
    await this.audit?.publish(companyId,'provider_commit_completed',{
      draftId:draft.draftId,
      executionId:execution.executionId,
      status:execution.status,
      providerReference:execution.providerReference??null
    },{actorId:connection.subjectId,correlationId:draft.draftId,at:execution.committedAt});
    return execution;
  }
}
