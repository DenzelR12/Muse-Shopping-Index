export type TrustTier='CONNECTED'|'VERIFIED'|'TRANSACTION_READY'|'AUTONOMOUS_READY';
export type CommerceVertical='retail'|'travel'|'tickets'|'services'|'reservations'|'digital'|'other';
export type ApprovalMode='ALWAYS_ASK'|'ALLOW_UNDER_LIMIT'|'BLOCK';
export type RecoveryAction='TRACK'|'CANCEL'|'RETURN'|'EXCHANGE'|'REFUND'|'REBOOK'|'SUPPORT_HANDOFF';

export interface PortablePreferenceVault {
  subjectId:string;
  updatedAt:string;
  version:number;
  preferences:{
    sizes?:Record<string,string>;
    preferredBrands?:string[];
    avoidedBrands?:string[];
    budgetBands?:Record<string,{min?:number;max?:number;currency:string}>;
    dietary?:string[];
    travel?:Record<string,string|number|boolean>;
    delivery?:Record<string,string|number|boolean>;
    accessibility?:string[];
    loyaltyProgramIds?:string[];
  };
  grants:Array<{
    companyId:string;
    fields:string[];
    grantedAt:string;
    expiresAt?:string;
    revokedAt?:string;
  }>;
}

export interface ConsumerPolicy {
  policyId:string;
  subjectId:string;
  vertical?:CommerceVertical;
  category?:string;
  action:'BUY'|'BOOK'|'RETURN'|'REORDER';
  mode:ApprovalMode;
  maxAmount?:number;
  currency?:string;
  requireRefundable?:boolean;
}

export interface CompanyTrustProfile {
  companyId:string;
  verticals:CommerceVertical[];
  identityVerified:boolean;
  apiUptime:number;
  inventoryAccuracy:number;
  deliverySuccess:number;
  onTimeRate:number;
  returnResolutionRate:number;
  supportResolutionRate:number;
  priceConsistency:number;
  policyCompliance:number;
  evidenceFreshness:number;
  tier:TrustTier;
  observations:number;
}

export interface AgentReceipt {
  receiptId:string;
  subjectId:string;
  companyIds:string[];
  createdAt:string;
  intent:string;
  consideredOfferIds:string[];
  selectedOfferIds:string[];
  reasons:string[];
  permissionsUsed:string[];
  approvalIds:string[];
  total:number;
  currency:string;
  commerceRails:string[];
  providerReferences:string[];
  fulfillmentState?:string;
  sourceEvidenceIds:string[];
}

export interface CrossCompanyAction {
  actionId:string;
  companyId:string;
  offerId:string;
  vertical:CommerceVertical;
  kind:'PURCHASE'|'BOOKING'|'RESERVATION'|'SERVICE';
  amount:number;
  currency:string;
  refundable?:boolean;
  dependencies?:string[];
}

export interface CrossCompanyPlan {
  planId:string;
  subjectId:string;
  intent:string;
  actions:CrossCompanyAction[];
  total:number;
  currency:string;
  approvalRequired:true;
  expiresAt:string;
}

export interface ConsolidatedApproval {
  approvalId:string;
  planId:string;
  subjectId:string;
  approvedActionIds:string[];
  declinedActionIds:string[];
  approvedAt:string;
}

export interface IntentOffer {
  offerId:string;
  companyId:string;
  intentFingerprint:string;
  price:number;
  currency:string;
  incentive?:string;
  deliveryEstimate?:string;
  loyaltyValue?:number;
  expiresAt:string;
  evidenceId:string;
}

export interface AttributionEvent {
  attributionId:string;
  companyId:string;
  campaignId?:string;
  adId?:string;
  intentId:string;
  transactionId?:string;
  stage:'INTENT'|'OFFER'|'DRAFT'|'APPROVAL'|'PURCHASE'|'DELIVERY'|'RETURN';
  occurredAt:string;
}

export interface LoyaltyBenefit {
  programId:string;
  companyId:string;
  label:string;
  monetaryValue?:number;
  currency?:string;
  benefitType:'POINTS'|'STATUS'|'DISCOUNT'|'PERK'|'CREDIT';
}

export interface MerchantDiagnostic {
  companyId:string;
  code:string;
  severity:'INFO'|'WARNING'|'CRITICAL';
  metric:string;
  observed:number;
  benchmark?:number;
  message:string;
  recommendedAction:string;
}

export interface VerticalBenchmark {
  vertical:CommerceVertical;
  metric:string;
  p25:number;
  median:number;
  p75:number;
  sampleSize:number;
  generatedAt:string;
}

export interface ConsumerControlCenter {
  subjectId:string;
  connectedCompanies:Array<{companyId:string;permissions:string[];expiresAt?:string;revokedAt?:string}>;
  pendingPlans:string[];
  activeOrders:string[];
  activeBookings:string[];
  returns:string[];
  automations:string[];
}

export interface HumanHandoff {
  handoffId:string;
  companyId:string;
  subjectId:string;
  reason:string;
  contextSummary:string;
  providerReference?:string;
  createdAt:string;
  status:'OPEN'|'ACCEPTED'|'RESOLVED';
}

export interface UniversalCommerceAuthorization {
  authorizationId:string;
  subjectId:string;
  companyId:string;
  actionIds:string[];
  maxAmount:number;
  currency:string;
  expiresAt:string;
  proofType:'SIGNED_APPROVAL'|'OAUTH_GRANT'|'PLATFORM_ASSERTION';
}

const clamp=(n:number)=>Math.max(0,Math.min(1,n));

export function deriveTrustTier(profile:Omit<CompanyTrustProfile,'tier'>):TrustTier{
  const score=
    clamp(profile.apiUptime)*.12+
    clamp(profile.inventoryAccuracy)*.14+
    clamp(profile.deliverySuccess)*.14+
    clamp(profile.onTimeRate)*.10+
    clamp(profile.returnResolutionRate)*.10+
    clamp(profile.supportResolutionRate)*.08+
    clamp(profile.priceConsistency)*.10+
    clamp(profile.policyCompliance)*.12+
    clamp(profile.evidenceFreshness)*.10;

  if(!profile.identityVerified) return 'CONNECTED';
  if(profile.observations<20||score<.70) return 'VERIFIED';
  if(profile.observations<100||score<.86) return 'TRANSACTION_READY';
  return 'AUTONOMOUS_READY';
}

export function approvePlan(
  plan:CrossCompanyPlan,
  policies:ConsumerPolicy[],
  approval:ConsolidatedApproval,
  now=new Date()
){
  if(plan.subjectId!==approval.subjectId) throw new Error('approval_subject_mismatch');
  if(plan.planId!==approval.planId) throw new Error('approval_plan_mismatch');
  if(new Date(plan.expiresAt).getTime()<=now.getTime()) throw new Error('plan_expired');

  const allIds=new Set(plan.actions.map(action=>action.actionId));
  for(const id of [...approval.approvedActionIds,...approval.declinedActionIds]){
    if(!allIds.has(id)) throw new Error('approval_contains_unknown_action');
  }

  const approved=plan.actions.filter(action=>approval.approvedActionIds.includes(action.actionId));
  for(const action of approved){
    const applicable=policies.filter(policy=>
      policy.subjectId===plan.subjectId &&
      (!policy.vertical||policy.vertical===action.vertical) &&
      (policy.action==='BUY'||policy.action==='BOOK')
    );
    for(const policy of applicable){
      if(policy.mode==='BLOCK') throw new Error('consumer_policy_blocks_action');
      if(policy.mode==='ALLOW_UNDER_LIMIT'&&policy.maxAmount!==undefined&&action.amount>policy.maxAmount){
        throw new Error('consumer_policy_limit_exceeded');
      }
      if(policy.requireRefundable&&action.refundable!==true) throw new Error('consumer_policy_requires_refundable');
    }
  }
  return {approved,declined:plan.actions.filter(action=>approval.declinedActionIds.includes(action.actionId))};
}

export function rankIntentOffers(offers:IntentOffer[],trust:Map<string,CompanyTrustProfile>,now=new Date()){
  return offers
    .filter(offer=>new Date(offer.expiresAt).getTime()>now.getTime())
    .map(offer=>{
      const profile=trust.get(offer.companyId);
      const trustScore=profile?[
        profile.inventoryAccuracy,
        profile.deliverySuccess,
        profile.onTimeRate,
        profile.priceConsistency,
        profile.policyCompliance
      ].reduce((a,b)=>a+b,0)/5:.5;
      const loyalty=Math.max(0,offer.loyaltyValue??0);
      const effectiveValue=Math.max(0,offer.price-loyalty);
      return {offer,trustScore,effectiveValue};
    })
    .sort((a,b)=>b.trustScore-a.trustScore||a.effectiveValue-b.effectiveValue);
}

export function buildMerchantDiagnostics(args:{
  companyId:string;
  apiLatencyMs:number;
  verticalMedianLatencyMs:number;
  inventoryAccuracy:number;
  verticalMedianInventoryAccuracy:number;
  abandonmentRate:number;
  verticalMedianAbandonmentRate:number;
}):MerchantDiagnostic[]{
  const out:MerchantDiagnostic[]=[];
  if(args.apiLatencyMs>args.verticalMedianLatencyMs*1.5){
    out.push({
      companyId:args.companyId,code:'API_LATENCY',severity:'WARNING',metric:'api_latency_ms',
      observed:args.apiLatencyMs,benchmark:args.verticalMedianLatencyMs,
      message:'API latency is materially above the vertical median.',
      recommendedAction:'Reduce connector response time or add caching for read-only inventory queries.'
    });
  }
  if(args.inventoryAccuracy<args.verticalMedianInventoryAccuracy){
    out.push({
      companyId:args.companyId,code:'INVENTORY_ACCURACY',severity:'CRITICAL',metric:'inventory_accuracy',
      observed:args.inventoryAccuracy,benchmark:args.verticalMedianInventoryAccuracy,
      message:'Inventory accuracy trails the vertical benchmark.',
      recommendedAction:'Reconcile availability more frequently and revoke stale offers faster.'
    });
  }
  if(args.abandonmentRate>args.verticalMedianAbandonmentRate*1.25){
    out.push({
      companyId:args.companyId,code:'ABANDONMENT',severity:'WARNING',metric:'draft_abandonment_rate',
      observed:args.abandonmentRate,benchmark:args.verticalMedianAbandonmentRate,
      message:'Customers abandon transaction drafts more often than the benchmark.',
      recommendedAction:'Review pricing changes, approval friction, delivery promises, and required form fields.'
    });
  }
  return out;
}

export function outcomeEffortScore(args:{completed:boolean;consumerActions:number;recoveryActions:number}){
  if(!args.completed) return 0;
  const effort=Math.max(1,args.consumerActions+args.recoveryActions*2);
  return Number((1/effort).toFixed(4));
}
