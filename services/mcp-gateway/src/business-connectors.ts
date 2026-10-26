export type ConnectorVertical='retail'|'travel'|'tickets'|'services'|'reservations'|'digital'|'other';

export type ConnectorAction =
  | 'search_offers'
  | 'create_action_draft'
  | 'execute_action';

export type ConnectorActionRisk='READ'|'DRAFT'|'COMMIT';
export type BusinessReadinessStage='CONNECTED'|'VERIFIED'|'TRANSACTION_READY'|'AUTONOMOUS_READY';
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

export interface BusinessReadinessEvidence {
  connectorConfigured:boolean;
  identityVerified:boolean;
  metaBusinessVerified?:boolean;
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
  metaBusinessRequired:true;
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

export function deriveBusinessReadiness(evidence:BusinessReadinessEvidence):BusinessReadinessStage {
  if(!evidence.connectorConfigured) return 'CONNECTED';
  if(!evidence.identityVerified||evidence.metaBusinessVerified!==true) return 'CONNECTED';
  if(!evidence.catalogValidated) return 'VERIFIED';

  const transactionReady=
    evidence.liveInventory &&
    evidence.livePricing &&
    evidence.transactionAction &&
    evidence.webhookEvents &&
    evidence.idempotency &&
    evidence.providerRevalidation;

  if(!transactionReady) return 'VERIFIED';

  const autonomousReady=
    evidence.agentPolicyConfigured &&
    evidence.auditTrail &&
    evidence.recoveryActions &&
    evidence.fulfillmentStatus;

  return autonomousReady?'AUTONOMOUS_READY':'TRANSACTION_READY';
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
}):BusinessCapabilityManifest {
  const readiness=deriveBusinessReadiness(args.evidence);
  const canTransact=readiness==='TRANSACTION_READY'||readiness==='AUTONOMOUS_READY';
  return {
    companyId:args.companyId,
    vertical:args.vertical,
    readiness,
    integrationMode:args.integrationMode,
    metaBusinessRequired:true,
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
