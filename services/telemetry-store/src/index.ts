import { assertBundleEvent, type BundleEvent, type TelemetrySink } from '@gift-signal/telemetry';

export interface SqlExecutor {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export class PostgresTelemetrySink implements TelemetrySink {
  constructor(private readonly db: SqlExecutor) {}

  async publish(input: BundleEvent): Promise<void> {
    const event = assertBundleEvent(input);
    const c = event.context;
    await this.db.query(
      `INSERT INTO bundle_telemetry_events (
        event_id, occurred_at, session_id, request_id, bundle_id,
        recipient_context_id, event_name, currency, target_budget,
        hard_budget, product_ids, total_value, source, attributes
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb
      )
      ON CONFLICT (event_id) DO NOTHING`,
      [
        c.eventId,
        c.occurredAt,
        c.sessionId,
        c.requestId,
        c.bundleId ?? null,
        c.recipientContextId ?? null,
        event.name,
        c.currency,
        c.targetBudget ?? null,
        c.hardBudget ?? null,
        c.productIds ?? [],
        c.totalValue ?? null,
        c.source ?? null,
        JSON.stringify(event.attributes ?? {})
      ]
    );
  }
}

export interface BundleTelemetrySummaryRow {
  eventName: string;
  count: number;
}

export async function summarizeBundleTelemetry(
  db: SqlExecutor,
  sinceIso: string
): Promise<unknown> {
  return db.query(
    `SELECT event_name, count(*)::int AS count
     FROM bundle_telemetry_events
     WHERE occurred_at >= $1
     GROUP BY event_name
     ORDER BY event_name`,
    [sinceIso]
  );
}
