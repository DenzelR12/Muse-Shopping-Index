export type ExceptionType =
  | 'inventory_failure'
  | 'price_anomaly'
  | 'missing_tracking'
  | 'late_fulfillment'
  | 'supplier_sync_failure'
  | 'payment_exception'
  | 'dispute'
  | 'return_exception'
  | 'high_risk_order'
  | 'semantic_qa_failure';

export type ExceptionSeverity = 'info' | 'warning' | 'critical';

export interface OpsSignal {
  type: ExceptionType;
  entityId: string;
  occurredAt: string;
  evidence: Record<string, unknown>;
}

export interface OpsException extends OpsSignal {
  severity: ExceptionSeverity;
  requiresHumanReview: boolean;
  reason: string;
}

const humanReviewAlways = new Set<ExceptionType>([
  'payment_exception',
  'dispute',
  'return_exception',
  'high_risk_order'
]);

export function classifyException(signal: OpsSignal): OpsException {
  const severe = new Set<ExceptionType>([
    'supplier_sync_failure',
    'late_fulfillment',
    'payment_exception',
    'dispute',
    'high_risk_order'
  ]);

  return {
    ...signal,
    severity: severe.has(signal.type) ? 'critical' : 'warning',
    requiresHumanReview: humanReviewAlways.has(signal.type),
    reason: exceptionReason(signal.type)
  };
}

function exceptionReason(type: ExceptionType): string {
  switch (type) {
    case 'inventory_failure': return 'Inventory state is inconsistent or unavailable.';
    case 'price_anomaly': return 'Price is outside the expected supplier or catalog range.';
    case 'missing_tracking': return 'A fulfilled order has no usable carrier tracking data.';
    case 'late_fulfillment': return 'Fulfillment timing has exceeded the expected dispatch window.';
    case 'supplier_sync_failure': return 'Supplier synchronization did not complete successfully.';
    case 'payment_exception': return 'Payment state requires deterministic reconciliation.';
    case 'dispute': return 'A payment dispute requires evidence and policy review.';
    case 'return_exception': return 'A return cannot be resolved by the standard return policy.';
    case 'high_risk_order': return 'Order risk exceeded the configured policy threshold.';
    case 'semantic_qa_failure': return 'Product context is not complete enough for top-ranked recommendation.';
  }
}

export function shouldNotifyOwner(exception: OpsException): boolean {
  return exception.requiresHumanReview || exception.severity === 'critical';
}
