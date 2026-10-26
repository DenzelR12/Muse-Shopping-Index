export const bundleEventNames = [
  'bundle_requested',
  'bundle_candidate_generated',
  'bundle_viewed',
  'bundle_item_removed',
  'bundle_item_swapped',
  'bundle_added_to_cart',
  'bundle_checkout_started',
  'bundle_purchased'
] as const;

export type BundleEventName = typeof bundleEventNames[number];

export interface BundleEventContext {
  eventId: string;
  occurredAt: string;
  sessionId: string;
  requestId: string;
  bundleId?: string;
  recipientContextId?: string;
  currency: string;
  targetBudget?: number;
  hardBudget?: boolean;
  productIds?: string[];
  totalValue?: number;
  source?: 'storefront' | 'business' | 'api' | 'mcp';
}

export interface BundleEvent {
  name: BundleEventName;
  context: BundleEventContext;
  attributes?: Record<string, string | number | boolean | null>;
}

export interface TelemetrySink {
  publish(event: BundleEvent): Promise<void>;
}

export function assertBundleEvent(event: BundleEvent): BundleEvent {
  if (!bundleEventNames.includes(event.name)) throw new Error('unsupported_bundle_event');
  if (!event.context.eventId || !event.context.occurredAt || !event.context.sessionId || !event.context.requestId) {
    throw new Error('invalid_bundle_event_context');
  }
  if (event.context.targetBudget !== undefined && event.context.targetBudget < 0) {
    throw new Error('invalid_target_budget');
  }
  if (event.context.totalValue !== undefined && event.context.totalValue < 0) {
    throw new Error('invalid_bundle_total');
  }
  return event;
}

export function budgetUtilization(event: BundleEvent): number | null {
  const target = event.context.targetBudget;
  const total = event.context.totalValue;
  if (!target || target <= 0 || total === undefined) return null;
  return Math.round((total / target) * 10000) / 100;
}
