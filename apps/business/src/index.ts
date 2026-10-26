export interface BusinessDashboard {
  catalogHealth:{active:number;draft:number;semanticReady:number};
  fulfillment:{missingTracking:number;lateRisk:number};
  gifting:{openGroupGifts:number;fundingAtRisk:number};
  api:{requests24h:number;errors24h:number};
  exceptions:string[];
}
export const ownerAbsentPrinciple='Normal operations should flow automatically; the owner is surfaced only for policy, money, security, or fulfillment exceptions.';

export * from './analytics.js';
export * from './bundles.js';
export * from './telemetry-dashboard.js';
export * from './product-context.js';
export * from './signal-standard.js';

export * from './agent-admission.js';

export * from './company-intelligence.js';

export * from './provider-console.js';
