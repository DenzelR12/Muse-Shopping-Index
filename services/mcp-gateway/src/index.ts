import { evaluateRisk } from '@gift-signal/signal-shield';
export const tools=['search_gifts','recommend_gifts','build_bundle','check_delivery','create_gift_draft','create_group_gift_draft','invite_approved_participants','request_gift_card','check_transaction_risk','escalate_review'] as const;
export function gateToolCall(actor:any,tool:string,payload:Record<string,unknown>){
  const capability = tool==='build_bundle'?'build_bundle':tool==='check_delivery'?'check_delivery':tool==='create_group_gift_draft'?'create_group_gift_draft':'search_gifts';
  return {tool,payload,risk:evaluateRisk({actor,capability:capability as any})};
}

export * from './business-approval.js';
export * from './business-identity.js';
export * from './business-zero-trust.js';
export * from './business-zero-trust-postgres.js';
export * from './business-security-audit.js';
export * from './business-connectors.js';

export * from './provider-adapters.js';

export * from './provider-oauth.js';
export * from './provider-token-exchange.js';
export * from './provider-sync.js';
export * from './provider-orders.js';
export * from './provider-order-create.js';
export * from './provider-pricing.js';
export * from './provider-landed-quote.js';
export * from './provider-draft-order.js';

export * from './provider-refresh.js';

export * from './provider-lifecycle.js';

export * from './provider-credential-vault.js';

export * from './provider-runtime.js';

export * from './provider-oauth-transactions.js';

export * from './provider-account-identity.js';

export * from './provider-revoke.js';
