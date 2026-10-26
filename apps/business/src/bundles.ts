export interface BundleMetrics {
  requests: number;
  candidates: number;
  viewed: number;
  addedToCart: number;
  purchases: number;
  averageBudgetUtilization: number;
}

export interface BundleExceptionSummary {
  semanticQaFailures: number;
  inventoryFailures: number;
  priceAnomalies: number;
  fulfillmentExceptions: number;
}

export interface BundleDashboard {
  metrics: BundleMetrics;
  exceptions: BundleExceptionSummary;
  topBundleModes: Array<{ mode: string; purchases: number }>;
  recentRequests: Array<{ requestId: string; source: string; targetBudget?: number; generatedBundles: number }>;
}

export const bundleControlPlanePrinciple = 'Business observes and configures bundle behavior; Gift Intelligence ranks products and Signal Shield controls policy.';
