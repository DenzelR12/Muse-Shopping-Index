export interface BundleMetricInput {
  event: string;
  requestId: string;
  source?: string;
  targetBudget?: number;
  totalValue?: number;
}

export interface BundleMetricSummary {
  requests: number;
  candidates: number;
  views: number;
  cartAdds: number;
  checkouts: number;
  purchases: number;
  conversionRate: number;
  averageBudgetUtilization: number;
}

export function summarizeBundleMetrics(events: BundleMetricInput[]): BundleMetricSummary {
  const count = (name: string) => events.filter(event => event.event === name).length;
  const utilization = events
    .filter(event => event.targetBudget && event.targetBudget > 0 && event.totalValue !== undefined)
    .map(event => (event.totalValue! / event.targetBudget!) * 100);
  const requests = count('bundle_requested');
  const purchases = count('bundle_purchased');

  return {
    requests,
    candidates: count('bundle_candidate_generated'),
    views: count('bundle_viewed'),
    cartAdds: count('bundle_added_to_cart'),
    checkouts: count('bundle_checkout_started'),
    purchases,
    conversionRate: requests ? Math.round((purchases / requests) * 10000) / 100 : 0,
    averageBudgetUtilization: utilization.length
      ? Math.round((utilization.reduce((sum, value) => sum + value, 0) / utilization.length) * 100) / 100
      : 0
  };
}
