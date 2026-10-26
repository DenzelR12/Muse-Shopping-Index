export type Capability =
  | 'search_gifts' | 'recommend_gifts' | 'build_bundle' | 'check_delivery'
  | 'create_gift_draft' | 'create_group_gift_draft' | 'invite_participant'
  | 'record_telemetry'
  | 'request_payment' | 'refund_payment' | 'issue_gift_value'
  | 'manage_provider_connections' | 'admin_override';

export interface ActorContext {
  actorId: string;
  actorType: 'human'|'agent'|'service'|'unknown';
  roles: string[];
  capabilities?: Capability[];
  riskScore?: number;
}

export function authorize(actor: ActorContext, capability: Capability): {allowed:boolean; reason:string} {
  if(actor.capabilities && !actor.capabilities.includes(capability)) {
    return {allowed:false, reason:'Actor lacks the requested capability.'};
  }
  const highRisk: Capability[] = ['refund_payment','issue_gift_value','admin_override'];
  if (highRisk.includes(capability) && !actor.roles.includes('owner')) {
    return {allowed:false, reason:'High-risk capability requires explicit owner authorization.'};
  }
  if ((actor.riskScore ?? 0) >= 80) return {allowed:false, reason:'Actor risk exceeds policy threshold.'};
  return {allowed:true, reason:'Allowed by deterministic capability policy.'};
}
