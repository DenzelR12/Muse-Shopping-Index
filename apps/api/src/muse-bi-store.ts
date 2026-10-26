import type { Pool } from 'pg';
import type { BiEventStore, BiFunnelEvent, BiMetric, BiWatermark } from './muse-bi.js';

/**
 * Persisted BI funnel instrumentation, following the existing Postgres
 * store pattern in this service (see muse-seller-display-store.ts and
 * provider-transaction-store.ts): the store creates its own tables on
 * first use with CREATE TABLE IF NOT EXISTS, so no separate migration
 * run is required, and infra/db/schema.sql is untouched.
 *
 * One row per funnel event. campaignId / reelId travel with the event
 * from intent through review, approval, transaction, and verified
 * outcome, so the funnel is keyed by draftId + companyId end to end.
 * This store records SUPPLIED / DEMO events and events carried from
 * the existing transaction path by server-side callers only; it does
 * NOT ingest live Meta ads, and it never changes campaigns, budgets,
 * routing, ranking, or policy.
 *
 * The watermark table holds one row per (metric, companyId): the last
 * verified artifact timestamp + input hash. Only
 * applyBiIngestionResult() in muse-bi.ts decides whether a watermark
 * advances; this store only persists the value it is given, so a
 * failed ingestion can never advance it through this store alone.
 */

function rowToEvent(row: any): BiFunnelEvent {
  return {
    companyId: String(row.company_id),
    draftId: String(row.draft_id),
    campaignId: row.campaign_id ?? null,
    reelId: row.reel_id ?? null,
    stage: row.stage,
    occurredAt: new Date(row.occurred_at).toISOString(),
    acquisition: row.acquisition,
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
    currency: row.currency ?? null,
    refundAmount: Number(row.refund_amount ?? 0),
    cancelled: row.cancelled === true,
    paymentVehicle: row.payment_vehicle ?? null,
    origin: row.origin ?? 'unknown',
    outcomeRef: row.outcome_ref ?? null,
    transactionRef: row.transaction_ref ?? null,
    orderRef: row.order_ref ?? null,
    approvalJti: row.approval_jti ?? null,
    approvalHash: row.approval_hash ?? null,
  };
}

export class PostgresBiEventStore implements BiEventStore {
  private initialized = false;
  constructor(private readonly pool: Pool) {}

  private async init() {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS muse_bi_events (
        id BIGSERIAL PRIMARY KEY,
        company_id TEXT NOT NULL,
        draft_id TEXT NOT NULL,
        campaign_id TEXT,
        reel_id TEXT,
        stage TEXT NOT NULL,
        acquisition TEXT NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        amount NUMERIC,
        currency TEXT,
        refund_amount NUMERIC NOT NULL DEFAULT 0,
        cancelled BOOLEAN NOT NULL DEFAULT false,
        payment_vehicle TEXT,
        origin TEXT NOT NULL DEFAULT 'unknown',
        outcome_ref TEXT,
        transaction_ref TEXT,
        order_ref TEXT,
        approval_jti TEXT,
        approval_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS idx_muse_bi_events_company_draft ON muse_bi_events(company_id, draft_id, occurred_at)'
    );
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS muse_bi_watermarks (
        metric TEXT NOT NULL,
        company_id TEXT NOT NULL,
        last_verified_at TIMESTAMPTZ NOT NULL,
        input_hash TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY(metric, company_id)
      )
    `);
    this.initialized = true;
  }

  async record(event: BiFunnelEvent): Promise<BiFunnelEvent> {
    await this.init();
    await this.pool.query(
      `INSERT INTO muse_bi_events
        (company_id, draft_id, campaign_id, reel_id, stage, acquisition, occurred_at, amount, currency,
         refund_amount, cancelled, payment_vehicle, origin, outcome_ref, transaction_ref, order_ref, approval_jti, approval_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        event.companyId, event.draftId, event.campaignId, event.reelId, event.stage, event.acquisition,
        event.occurredAt, event.amount, event.currency, event.refundAmount, event.cancelled,
        event.paymentVehicle, event.origin, event.outcomeRef, event.transactionRef, event.orderRef,
        event.approvalJti, event.approvalHash,
      ]
    );
    return { ...event };
  }

  async list(companyId: string): Promise<BiFunnelEvent[]> {
    await this.init();
    const result = await this.pool.query(
      'SELECT * FROM muse_bi_events WHERE company_id=$1 ORDER BY occurred_at ASC, id ASC',
      [companyId]
    );
    return result.rows.map(rowToEvent);
  }

  async listForDraft(companyId: string, draftId: string): Promise<BiFunnelEvent[]> {
    await this.init();
    const result = await this.pool.query(
      'SELECT * FROM muse_bi_events WHERE company_id=$1 AND draft_id=$2 ORDER BY occurred_at ASC, id ASC',
      [companyId, draftId]
    );
    return result.rows.map(rowToEvent);
  }

  async getWatermark(metric: BiMetric, companyId: string): Promise<BiWatermark | null> {
    await this.init();
    const result = await this.pool.query(
      'SELECT metric, company_id, last_verified_at, input_hash, artifact_id FROM muse_bi_watermarks WHERE metric=$1 AND company_id=$2',
      [metric, companyId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      metric: String(row.metric) as BiMetric,
      companyId: String(row.company_id),
      lastVerifiedAt: new Date(row.last_verified_at).toISOString(),
      inputHash: String(row.input_hash),
      artifactId: String(row.artifact_id),
    };
  }

  async setWatermark(watermark: BiWatermark): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO muse_bi_watermarks (metric, company_id, last_verified_at, input_hash, artifact_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (metric, company_id) DO UPDATE SET
         last_verified_at=EXCLUDED.last_verified_at, input_hash=EXCLUDED.input_hash,
         artifact_id=EXCLUDED.artifact_id, updated_at=now()`,
      [watermark.metric, watermark.companyId, watermark.lastVerifiedAt, watermark.inputHash, watermark.artifactId]
    );
  }
}
