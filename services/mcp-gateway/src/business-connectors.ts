export type ConnectorVertical='retail'|'travel'|'tickets'|'services'|'reservations'|'digital'|'other';

export type ConnectorAction =
  | 'search_offers'
  | 'create_action_draft'
  | 'execute_action';

export type ConnectorActionRisk='READ'|'DRAFT'|'COMMIT';
// Meta-origin businesses walk CONNECTED -> META_VERIFIED -> CATALOG_VERIFIED ->
// TRANSACTION_READY -> AUTONOMOUS_READY. Non-Meta-origin businesses keep the
// pre-existing CONNECTED -> VERIFIED -> TRANSACTION_READY -> AUTONOMOUS_READY
// ladder. VERIFIED therefore only ever appears for non-Meta-origin
// businesses; it is never a Meta-origin stage.
export type BusinessReadinessStage='CONNECTED'|'META_VERIFIED'|'CATALOG_VERIFIED'|'VERIFIED'|'TRANSACTION_READY'|'AUTONOMOUS_READY';
export type BusinessOrigin='meta'|'non-meta';
export type IntegrationMode='ZERO_CODE'|'LOW_CODE'|'CUSTOM_API';

export interface ConnectorActionDefinition {
  name:ConnectorAction;
  title:string;
  description:string;
  risk:ConnectorActionRisk;
  requiresApproval:boolean;
}

export interface CompanyConnectorManifest {
  companyId:string;
  slug:string;
  displayName:string;
  vertical:ConnectorVertical;
  status:'ACTIVE'|'PAUSED';
  actions:ConnectorActionDefinition[];
}

// Server-recorded Meta business verification evidence. This is a record of
// verification that was confirmed and stored server-side; it is NOT a live
// Meta API verification, and it is never accepted from model output or
// browser JSON alone. `issuer` names the authority that issued the
// verification (for example the Meta business record); `source` names the
// server-side recording channel. Self-attestation, model output and browser
// JSON are rejected by validateMetaBusinessVerification, as are missing,
// placeholder or expired evidence. `expiresAt` is optional: evidence without
// it does not expire on its own, so callers should set it whenever the
// issuer supplies an expiry.
export interface MetaBusinessVerification {
  verified:boolean;
  verifiedAt:string;
  evidenceRef:string;
  issuer:string;
  source:string;
  expiresAt?:string;
}

export interface BusinessReadinessEvidence {
  // Business origin. Omitted origin fails closed to the Meta-origin path:
  // callers must explicitly set origin:'non-meta' to use the non-Meta path.
  // Never infer origin from a model statement, a browser payload, or a
  // provider display name; it is a server-owned enrollment fact.
  origin?:BusinessOrigin;
  connectorConfigured:boolean;
  identityVerified:boolean;
  // Legacy flag. For Meta-origin businesses it must agree with a valid
  // metaVerification record: a flag without evidence, or evidence without
  // the flag, both fail closed. For non-Meta-origin businesses it is ignored.
  metaBusinessVerified?:boolean;
  metaVerification?:MetaBusinessVerification;
  catalogValidated:boolean;
  liveInventory:boolean;
  livePricing:boolean;
  transactionAction:boolean;
  webhookEvents:boolean;
  idempotency:boolean;
  providerRevalidation:boolean;
  agentPolicyConfigured:boolean;
  auditTrail:boolean;
  recoveryActions:boolean;
  fulfillmentStatus:boolean;
}

export interface BusinessCapabilityManifest {
  companyId:string;
  vertical:ConnectorVertical;
  readiness:BusinessReadinessStage;
  integrationMode:IntegrationMode;
  // True for Meta-origin businesses (and for businesses whose origin is
  // omitted, which fail closed to the Meta path); false for explicitly
  // declared non-Meta-origin businesses.
  metaBusinessRequired:boolean;
  capabilities:{
    search:boolean;
    quote:boolean;
    reserve:boolean;
    purchase:boolean;
    cancel:boolean;
    refund:boolean;
    trackOrder:boolean;
    sendGift:boolean;
  };
  agentPolicy:{
    allowedAgents:string[];
    maxOrderAmount?:number;
    currency?:string;
    humanApprovalRequiredForCommit:boolean;
  };
}

export interface CustomerConnection {
  connectionId:string;
  companyId:string;
  subjectId:string;
  grantedActions:ConnectorAction[];
  secretRef:string;
  createdAt:string;
  expiresAt?:string;
  revokedAt?:string;
}

export interface OfferSearchRequest {
  query:string;
  partySize?:number;
  destination?:string;
  startDate?:string;
  endDate?:string;
  maxTotal?:number;
  currency?:string;
  attributes?:Record<string,string|number|boolean>;
}

export interface NormalizedOffer {
  offerId:string;
  title:string;
  provider:string;
  price:number;
  currency:string;
  availability:'AVAILABLE'|'LIMITED'|'UNAVAILABLE'|'UNKNOWN';
  evidenceAt:string;
  sourceUrl?:string;
  attributes?:Record<string,string|number|boolean|null>;
}

export interface ConnectorActionDraft {
  draftId:string;
  companyId:string;
  connectionId:string;
  kind:'PURCHASE'|'BOOKING';
  offerIds:string[];
  quantity:number;
  total:number;
  currency:string;
  summary:string;
  createdAt:string;
  expiresAt:string;
  approvalRequired:true;
  liveRevalidationRequired:true;
  providerState?:Record<string,unknown>;
}

export interface ConnectorExecution {
  executionId:string;
  draftId:string;
  status:'CONFIRMED'|'DECLINED'|'FAILED';
  providerReference?:string;
  committedAt:string;
  message:string;
}

export interface CompanyConnectorAdapter {
  search(request:OfferSearchRequest,connection:CustomerConnection):Promise<NormalizedOffer[]>;
  createDraft(args:{
    offerIds:string[];
    quantity:number;
    kind:'PURCHASE'|'BOOKING';
    connection:CustomerConnection;
  }):Promise<ConnectorActionDraft>;
  execute(args:{
    draft:ConnectorActionDraft;
    connection:CustomerConnection;
    approval:{approved:true;approvedAt:string;approvalId:string};
  }):Promise<ConnectorExecution>;
}

export interface ClickReduction {
  baselineClicks:number;
  connectorClicks:number;
  removedClicks:number;
  reductionPercent:number;
}

export function clickReduction(baselineClicks:number,connectorClicks:number):ClickReduction {
  if(!Number.isInteger(baselineClicks)||!Number.isInteger(connectorClicks)||baselineClicks<0||connectorClicks<0){
    throw new Error('click_counts_must_be_non_negative_integers');
  }
  if(connectorClicks>baselineClicks) throw new Error('connector_clicks_exceed_baseline');
  const removedClicks=baselineClicks-connectorClicks;
  return {
    baselineClicks,
    connectorClicks,
    removedClicks,
    reductionPercent:baselineClicks===0?0:Math.round((removedClicks/baselineClicks)*100)
  };
}

const SELF_ATTESTED_SOURCES=new Set([
  'self','self-attested','self_attested','selfattested',
  'model','model-output','model_output',
  'browser','browser-json','browser_json',
  'user-claim','user_claim','user-attestation','user_attestation',
  'unverified','none',''
]);

const PLACEHOLDER_EVIDENCE_REFS=new Set(['pending','todo','tbd','none','n/a','placeholder']);

export function validateMetaBusinessVerification(
  value:unknown,
  now=new Date()
):{valid:boolean;reason:string} {
  if(!value||typeof value!=='object'||Array.isArray(value)) {
    return {valid:false,reason:'meta_verification_missing'};
  }
  const verification=value as Partial<MetaBusinessVerification>;
  if(verification.verified!==true) {
    return {valid:false,reason:'meta_verification_not_confirmed'};
  }
  const verifiedTime=Date.parse(String(verification.verifiedAt??''));
  if(!Number.isFinite(verifiedTime)) {
    return {valid:false,reason:'meta_verification_timestamp_invalid'};
  }
  if(verifiedTime>now.getTime()) {
    return {valid:false,reason:'meta_verification_timestamp_in_future'};
  }
  const evidenceRef=typeof verification.evidenceRef==='string'?verification.evidenceRef.trim():'';
  if(!evidenceRef||evidenceRef.length>500) {
    return {valid:false,reason:'meta_verification_evidence_ref_required'};
  }
  if(PLACEHOLDER_EVIDENCE_REFS.has(evidenceRef.toLowerCase())) {
    return {valid:false,reason:'meta_verification_evidence_ref_placeholder'};
  }
  const issuer=typeof verification.issuer==='string'?verification.issuer.trim():'';
  if(!issuer||issuer.length>200||SELF_ATTESTED_SOURCES.has(issuer.toLowerCase())||
    issuer.toLowerCase().includes('self-attest')||issuer.toLowerCase().includes('self_attest')) {
    return {valid:false,reason:'meta_verification_issuer_not_accepted'};
  }
  const source=typeof verification.source==='string'?verification.source.trim():'';
  if(!source||source.length>200||SELF_ATTESTED_SOURCES.has(source.toLowerCase())||
    source.toLowerCase().includes('self-attest')||source.toLowerCase().includes('self_attest')) {
    return {valid:false,reason:'meta_verification_source_not_accepted'};
  }
  if(verification.expiresAt!==undefined){
    const expiresTime=Date.parse(String(verification.expiresAt));
    if(!Number.isFinite(expiresTime)) {
      return {valid:false,reason:'meta_verification_timestamp_invalid'};
    }
    if(expiresTime<=now.getTime()) {
      return {valid:false,reason:'meta_verification_expired'};
    }
  }
  return {valid:true,reason:'meta_verification_valid'};
}

// Origin is a server-owned enrollment fact. Anything that is not explicitly
// declared 'non-meta' is treated as Meta-origin, so an omitted or unknown
// origin can never bypass the Meta verification gate.
export function isMetaBusinessOrigin(evidence:Pick<BusinessReadinessEvidence,'origin'>):boolean {
  return evidence.origin!=='non-meta';
}

export function deriveBusinessReadiness(
  evidence:BusinessReadinessEvidence,
  now=new Date()
):BusinessReadinessStage {
  if(!evidence.connectorConfigured) return 'CONNECTED';
  if(!evidence.identityVerified) return 'CONNECTED';

  const transactionReady=
    evidence.liveInventory &&
    evidence.livePricing &&
    evidence.transactionAction &&
    evidence.webhookEvents &&
    evidence.idempotency &&
    evidence.providerRevalidation;

  const autonomousReady=
    evidence.agentPolicyConfigured &&
    evidence.auditTrail &&
    evidence.recoveryActions &&
    evidence.fulfillmentStatus;

  if(isMetaBusinessOrigin(evidence)){
    // Meta-origin only: a business cannot leave CONNECTED until Meta
    // business verification evidence is confirmed. A bare
    // metaBusinessVerified flag is self-attestation and is not enough;
    // neither is a valid evidence record without the flag. Both must agree.
    // This is evidence-recorded verification, not a live Meta API claim.
    if(evidence.metaBusinessVerified!==true||
      !validateMetaBusinessVerification(evidence.metaVerification,now).valid) return 'CONNECTED';
    if(!evidence.catalogValidated) return 'META_VERIFIED';
    if(!transactionReady) return 'CATALOG_VERIFIED';
  } else {
    // Non-Meta-origin businesses keep their existing path unchanged:
    // Meta verification is neither required nor consulted.
    if(!evidence.catalogValidated) return 'VERIFIED';
    if(!transactionReady) return 'VERIFIED';
  }

  return autonomousReady?'AUTONOMOUS_READY':'TRANSACTION_READY';
}

// Fail-closed transaction gate for callers that check readiness before
// allowing a purchase, booking or other commit. A Meta-origin business
// without confirmed verification evidence throws
// meta_business_verification_required; it is never approved at a degraded
// stage. Every other not-yet-transaction-ready business throws
// business_not_transaction_ready.
export function assertBusinessTransactionReady(
  evidence:BusinessReadinessEvidence,
  now=new Date()
):BusinessReadinessStage {
  const readiness=deriveBusinessReadiness(evidence,now);
  if(readiness==='TRANSACTION_READY'||readiness==='AUTONOMOUS_READY') return readiness;
  if(isMetaBusinessOrigin(evidence)&&
    (evidence.metaBusinessVerified!==true||
      !validateMetaBusinessVerification(evidence.metaVerification,now).valid)) {
    throw new Error('meta_business_verification_required');
  }
  throw new Error('business_not_transaction_ready');
}

export function buildBusinessCapabilityManifest(args:{
  companyId:string;
  vertical:ConnectorVertical;
  integrationMode:IntegrationMode;
  evidence:BusinessReadinessEvidence;
  capabilities?:Partial<BusinessCapabilityManifest['capabilities']>;
  allowedAgents?:string[];
  maxOrderAmount?:number;
  currency?:string;
  now?:Date;
}):BusinessCapabilityManifest {
  const readiness=deriveBusinessReadiness(args.evidence,args.now??new Date());
  const canTransact=readiness==='TRANSACTION_READY'||readiness==='AUTONOMOUS_READY';
  return {
    companyId:args.companyId,
    vertical:args.vertical,
    readiness,
    integrationMode:args.integrationMode,
    metaBusinessRequired:isMetaBusinessOrigin(args.evidence),
    capabilities:{
      search:args.evidence.catalogValidated,
      quote:args.evidence.livePricing,
      reserve:Boolean(args.capabilities?.reserve&&canTransact),
      purchase:Boolean(args.capabilities?.purchase&&canTransact),
      cancel:Boolean(args.capabilities?.cancel&&canTransact),
      refund:Boolean(args.capabilities?.refund&&canTransact),
      trackOrder:Boolean(args.capabilities?.trackOrder&&args.evidence.fulfillmentStatus),
      sendGift:Boolean(args.capabilities?.sendGift&&canTransact)
    },
    agentPolicy:{
      allowedAgents:[...(args.allowedAgents??[])],
      maxOrderAmount:args.maxOrderAmount,
      currency:args.currency,
      humanApprovalRequiredForCommit:true
    }
  };
}

export function validateConnection(
  manifest:CompanyConnectorManifest,
  connection:CustomerConnection,
  action:ConnectorAction,
  now=new Date()
){
  if(manifest.status!=='ACTIVE') return {allowed:false,reason:'Company connector is paused.'} as const;
  if(connection.companyId!==manifest.companyId) return {allowed:false,reason:'Connection does not belong to this company.'} as const;
  if(connection.revokedAt) return {allowed:false,reason:'Customer connection has been revoked.'} as const;
  if(connection.expiresAt && new Date(connection.expiresAt).getTime()<=now.getTime()) {
    return {allowed:false,reason:'Customer connection has expired.'} as const;
  }
  if(!connection.grantedActions.includes(action)) return {allowed:false,reason:'Customer did not grant this connector action.'} as const;
  if(!manifest.actions.some(candidate=>candidate.name===action)) return {allowed:false,reason:'Company does not expose this connector action.'} as const;
  return {allowed:true,reason:'Connection and delegated action are valid.'} as const;
}

export class ConnectorRegistry {
  private readonly manifests=new Map<string,CompanyConnectorManifest>();
  private readonly adapters=new Map<string,CompanyConnectorAdapter>();

  register(manifest:CompanyConnectorManifest,adapter:CompanyConnectorAdapter){
    if(this.manifests.has(manifest.companyId)) throw new Error('connector_company_already_registered');
    this.manifests.set(manifest.companyId,structuredClone(manifest));
    this.adapters.set(manifest.companyId,adapter);
  }

  list(){
    return [...this.manifests.values()].map(manifest=>structuredClone(manifest));
  }

  get(companyId:string){
    const manifest=this.manifests.get(companyId);
    const adapter=this.adapters.get(companyId);
    if(!manifest||!adapter) throw new Error('unknown_company_connector');
    return {manifest:structuredClone(manifest),adapter};
  }
}

export class ConnectorRuntime {
  constructor(private readonly registry:ConnectorRegistry){}

  async search(companyId:string,connection:CustomerConnection,request:OfferSearchRequest){
    const {manifest,adapter}=this.registry.get(companyId);
    const gate=validateConnection(manifest,connection,'search_offers');
    if(!gate.allowed) throw new Error(gate.reason);
    const offers=await adapter.search(request,connection);
    return {company:manifest,offers,gate};
  }

  async createDraft(companyId:string,connection:CustomerConnection,args:{offerIds:string[];quantity:number;kind:'PURCHASE'|'BOOKING'}){
    const {manifest,adapter}=this.registry.get(companyId);
    const gate=validateConnection(manifest,connection,'create_action_draft');
    if(!gate.allowed) throw new Error(gate.reason);
    if(!args.offerIds.length) throw new Error('at_least_one_offer_required');
    if(!Number.isInteger(args.quantity)||args.quantity<1) throw new Error('quantity_must_be_positive_integer');
    const draft=await adapter.createDraft({...args,connection});
    if(draft.companyId!==companyId||draft.connectionId!==connection.connectionId) throw new Error('provider_returned_mismatched_draft');
    return {company:manifest,draft,gate};
  }

  async execute(companyId:string,connection:CustomerConnection,args:{draft:ConnectorActionDraft;approved:boolean;approvalId?:string},now=new Date()){
    const {manifest,adapter}=this.registry.get(companyId);
    const gate=validateConnection(manifest,connection,'execute_action',now);
    if(!gate.allowed) throw new Error(gate.reason);
    if(!args.approved||!args.approvalId?.trim()) throw new Error('explicit_user_approval_required');
    if(args.draft.companyId!==companyId||args.draft.connectionId!==connection.connectionId) throw new Error('draft_connection_mismatch');
    if(new Date(args.draft.expiresAt).getTime()<=now.getTime()) throw new Error('draft_expired_rebuild_required');
    return adapter.execute({
      draft:args.draft,
      connection,
      approval:{approved:true,approvedAt:now.toISOString(),approvalId:args.approvalId}
    });
  }
}

export const defaultConnectorActions:ConnectorActionDefinition[]=[
  {name:'search_offers',title:'Search live offers',description:'Search company inventory, rates or bookable offers.',risk:'READ',requiresApproval:false},
  {name:'create_action_draft',title:'Prepare purchase or booking',description:'Create a reviewable draft with live price and configuration.',risk:'DRAFT',requiresApproval:false},
  {name:'execute_action',title:'Complete purchase or booking',description:'Commit a previously reviewed draft after explicit user approval and provider revalidation.',risk:'COMMIT',requiresApproval:true}
];
