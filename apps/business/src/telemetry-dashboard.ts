import type { SqlExecutor } from '@gift-signal/telemetry-store';
import { summarizeBundleMetrics, type BundleMetricInput, type BundleMetricSummary } from './analytics.js';

interface QueryResultLike {
  rows?: unknown[];
}

function isMetricRow(value: unknown): value is BundleMetricInput {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.event === 'string' && typeof row.requestId === 'string';
}

export async function loadBundleMetricEvents(
  db: SqlExecutor,
  sinceIso: string
): Promise<BundleMetricInput[]> {
  const result = await db.query(
    `SELECT
       event_name AS event,
       request_id AS "requestId",
       source,
       target_budget::float8 AS "targetBudget",
       total_value::float8 AS "totalValue"
     FROM bundle_telemetry_events
     WHERE occurred_at >= $1
     ORDER BY occurred_at DESC`,
    [sinceIso]
  );

  const rows = (result as QueryResultLike)?.rows;
  return Array.isArray(rows) ? rows.filter(isMetricRow) : [];
}

export async function loadBusinessBundleSummary(
  db: SqlExecutor,
  sinceIso: string
): Promise<BundleMetricSummary> {
  return summarizeBundleMetrics(await loadBundleMetricEvents(db, sinceIso));
}
