import { buildBundle } from '@gift-signal/gift-intelligence';
import type { BundlePlan, GiftContext, ProductCandidate } from '@gift-signal/schemas';
import type { BundleEventName, TelemetrySink } from '@gift-signal/telemetry';

export type BundleSource = 'storefront' | 'business' | 'api' | 'mcp';

export interface BundleExecutionRequest {
  context: GiftContext;
  candidates: ProductCandidate[];
  sessionId: string;
  requestId: string;
  source: BundleSource;
}

export interface ExecutedBundle extends BundlePlan {
  bundleId: string;
  budgetUtilizationPercent: number | null;
}

export interface BundleInteraction {
  name: Extract<BundleEventName,
    'bundle_viewed' |
    'bundle_item_removed' |
    'bundle_item_swapped' |
    'bundle_added_to_cart' |
    'bundle_checkout_started' |
    'bundle_purchased'>;
  sessionId: string;
  requestId: string;
  bundleId: string;
  currency: string;
  productIds: string[];
  totalValue: number;
  source: BundleSource;
  targetBudget?: number;
  hardBudget?: boolean;
  attributes?: Record<string, string | number | boolean | null>;
}

export async function executeBundles(
  request: BundleExecutionRequest,
  sink?: TelemetrySink
): Promise<{ bundles: ExecutedBundle[]; generatedAt: string }> {
  const generatedAt = new Date().toISOString();
  const targetBudget = request.context.budgetMax;
  const plans = buildBundle(request.context, request.candidates);
  const bundles: ExecutedBundle[] = [];

  let index = 0;
  for (const plan of plans) {
    if (request.context.hardBudget && targetBudget !== undefined && plan.total > targetBudget) continue;
    if (plan.items.length === 0) continue;
    index += 1;
    const bundleId = `${request.requestId}-${index}`;
    const utilization = targetBudget && targetBudget > 0
      ? Math.round((plan.total / targetBudget) * 10000) / 100
      : null;
    const bundle = { ...plan, bundleId, budgetUtilizationPercent: utilization };
    bundles.push(bundle);

    if (sink) {
      await sink.publish({
        name: 'bundle_candidate_generated',
        context: {
          eventId: `${request.requestId}-candidate-${index}`,
          occurredAt: generatedAt,
          sessionId: request.sessionId,
          requestId: request.requestId,
          bundleId,
          currency: plan.items[0]?.currency ?? request.candidates[0]?.currency ?? 'USD',
          targetBudget,
          hardBudget: request.context.hardBudget,
          productIds: plan.items.map(item => item.productId),
          totalValue: plan.total,
          source: request.source
        },
        attributes: {
          mode: plan.mode,
          itemCount: plan.items.length,
          budgetUtilizationPercent: utilization
        }
      });
    }
  }

  if (sink) {
    await sink.publish({
      name: 'bundle_requested',
      context: {
        eventId: `${request.requestId}-requested`,
        occurredAt: generatedAt,
        sessionId: request.sessionId,
        requestId: request.requestId,
        currency: request.candidates[0]?.currency ?? 'USD',
        targetBudget,
        hardBudget: request.context.hardBudget,
        source: request.source
      },
      attributes: {
        candidateCount: request.candidates.length,
        generatedBundleCount: bundles.length
      }
    });
  }

  return { bundles, generatedAt };
}

export async function captureBundleInteraction(
  interaction: BundleInteraction,
  sink: TelemetrySink
): Promise<void> {
  if (!interaction.bundleId) throw new Error('bundle_id_required');
  if (interaction.totalValue < 0) throw new Error('bundle_total_invalid');

  const occurredAt = new Date().toISOString();
  await sink.publish({
    name: interaction.name,
    context: {
      eventId: `${interaction.requestId}-${interaction.name}-${interaction.bundleId}-${occurredAt}`,
      occurredAt,
      sessionId: interaction.sessionId,
      requestId: interaction.requestId,
      bundleId: interaction.bundleId,
      currency: interaction.currency,
      targetBudget: interaction.targetBudget,
      hardBudget: interaction.hardBudget,
      productIds: interaction.productIds,
      totalValue: interaction.totalValue,
      source: interaction.source
    },
    attributes: interaction.attributes
  });
}
