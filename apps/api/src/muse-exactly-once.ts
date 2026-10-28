/**
 * Exactly-once execution guard — Muse Shopping Index.
 *
 * Muse feature, not a storefront. This module answers one question, for
 * any consequential action (approve, payment, webhook ingest, BI event):
 * "has this exact action, for this exact tenant, already been claimed,
 * completed, or left in an uncertain state — and may this caller execute
 * it now, or must it stop?"
 *
 * WHAT IT IS:
 * - A claim, not a lock and not a queue. claim() atomically wins or
 *   loses for one (companyId, key) pair. The key is caller-supplied
 *   and must be stable for one logical action: draftId for an approval,
 *   leadgen_id for a lead webhook, draftId for a BI outcome, the Stripe
 *   idempotency key for a payment. A different key is a different
 *   action, even for the same draft; the same key in a different
 *   company is a different action, because claims are tenant-scoped.
 * - Won means "you are the only executor". Duplicate means "already
 *   completed — return the original result, do not execute again".
 *   In-progress means "someone else is executing — do not execute,
 *   resume or poll for state instead". Stale means "an in-progress
 *   claim passed its TTL — do NOT re-execute blindly; reconcile with
 *   the provider first, then complete or release on evidence".
 * - Postgres is the multi-instance store: claim() uses
 *   INSERT ... ON CONFLICT (company_id, claim_key) DO NOTHING, so two
 *   processes racing on the same key produce exactly one winner, and
 *   the loser sees the winner's in-progress row. The memory store is
 *   single-process only and is for tests; it must never be presented
 *   as multi-instance protection.
 * - A bounded burst limiter (per company, per instance) sits beside
 *   the claim: admitted / queued / rejected_queue_full. Rejection is
 *   fail-closed (muse_execution_queue_full), never a silent drop and
 *   never an execution past the cap.
 *
 * WHAT IT IS NOT:
 * - Not a live route, live queue, or live scaling claim. No route is
 *   mounted here, no host autoscaling is configured, and no 10,000-
 *   request load test has been run. A burst of 10,000 distinct
 *   actions is a throughput problem (host, queue, provider rate
 *   limits) on top of this guard, and it remains unproven until a
 *   concurrent load test is run against a scaled host.
 * - Not a replacement for the existing protections. Approval
 *   consume-once, signed-draft reapproval, Stripe idempotency keys,
 *   BI one-outcome-per-draftId, and lead dedup by leadgen_id all still
 *   apply; this guard is the shared claim underneath them, so a
 *   duplicate is stopped before any provider call, not after one.
 * - Not a secret store. A completed result stored here must never
 *   contain a token, card number, approval token, or webhook secret.
 *   Callers that pass such a value are violating this module's
 *   contract, and the store does not scrub it.
 * - Not an automatic retry. An uncertain failure leaves the claim
 *   in-progress until its TTL, then stale_reconcile. Only a definite
 *   failure (provider said "no, this did not happen") may release a
 *   claim, and only on evidence, never on a timeout alone.
 */

import type { Pool } from 'pg';

export interface ExactlyOncePrincipal {
  subject: string;
  companyId: string;
}

export type ExactlyOnceStatus = 'in_progress' | 'completed';

export interface ExactlyOnceClaimInput {
  key: string;
  companyId: string;
  draftId?: string;
  operation: string;
  /** TTL for an in-progress claim, in ms. Default 10 minutes (draft life). */
  ttlMs?: number;
  /** ISO timestamp, for tests. Defaults to now. */
  now?: string;
  principal?: ExactlyOncePrincipal;
}

export type ExactlyOnceOutcome =
  | 'won'
  | 'duplicate'
  | 'in_progress'
  | 'stale_reconcile';

export interface ExactlyOnceClaimResult {
  outcome: ExactlyOnceOutcome;
  /** Original result, only on 'duplicate'. Never a token or secret. */
  result?: unknown;
  /** When the winning claim expires, ISO timestamp. */
  expiresAt?: string;
}

export interface ExactlyOnceStore {
  claim(input: ExactlyOnceClaimInput): Promise<ExactlyOnceClaimResult>;
  complete(input: { key: string; companyId: string; result: unknown }): Promise<boolean>;
  /** Release only on a definite, evidenced failure. Never on timeout. */
  release(input: { key: string; companyId: string }): Promise<boolean>;
  purgeExpired(now: string): Promise<number>;
}

function requireNonEmpty(value: string | undefined, code: string): string {
  if (!value || value.trim() === '') throw new Error(code);
  return value;
}

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function expiresIso(now: string, ttlMs: number): string {
  return new Date(new Date(now).getTime() + ttlMs).toISOString();
}

interface StoredClaim {
  companyId: string;
  draftId?: string;
  operation: string;
  status: ExactlyOnceStatus;
  result?: unknown;
  claimedAt: string;
  expiresAt: string;
}

function decide(
  record: StoredClaim | undefined,
  input: ExactlyOnceClaimInput,
  now: string,
): ExactlyOnceClaimResult | null {
  if (!record) return null;
  if (record.status === 'completed') {
    return { outcome: 'duplicate', result: record.result, expiresAt: record.expiresAt };
  }
  if (new Date(now).getTime() >= new Date(record.expiresAt).getTime()) {
    return { outcome: 'stale_reconcile', expiresAt: record.expiresAt };
  }
  return { outcome: 'in_progress', expiresAt: record.expiresAt };
}

export class MemoryExactlyOnceStore implements ExactlyOnceStore {
  private readonly values = new Map<string, StoredClaim>();

  private mapKey(companyId: string, key: string): string {
    return `${companyId}\0${key}`;
  }

  async claim(input: ExactlyOnceClaimInput): Promise<ExactlyOnceClaimResult> {
    const key = requireNonEmpty(input.key, 'muse_exactly_once_key_required');
    const companyId = requireNonEmpty(input.companyId, 'muse_exactly_once_company_required');
    if (input.principal && input.principal.companyId !== companyId) {
      throw new Error('muse_exactly_once_tenant_mismatch');
    }
    const now = nowIso(input.now);
    const ttlMs = input.ttlMs ?? 10 * 60 * 1000;
    const mapKey = this.mapKey(companyId, key);
    // Synchronous check-and-set: no await before this point, so even
    // Promise.all over 100 concurrent claims in one process yields
    // exactly one winner.
    const existing = this.values.get(mapKey);
    const decision = decide(existing, input, now);
    if (decision) return decision;
    const expiresAt = expiresIso(now, ttlMs);
    this.values.set(mapKey, {
      companyId, draftId: input.draftId, operation: input.operation,
      status: 'in_progress', claimedAt: now, expiresAt,
    });
    return { outcome: 'won', expiresAt };
  }

  async complete(input: { key: string; companyId: string; result: unknown }): Promise<boolean> {
    const record = this.values.get(this.mapKey(input.companyId, input.key));
    if (!record || record.status !== 'in_progress') return false;
    record.status = 'completed';
    record.result = input.result;
    return true;
  }

  async release(input: { key: string; companyId: string }): Promise<boolean> {
    const mapKey = this.mapKey(input.companyId, input.key);
    const record = this.values.get(mapKey);
    if (!record || record.status !== 'in_progress') return false;
    this.values.delete(mapKey);
    return true;
  }

  async purgeExpired(now: string): Promise<number> {
    let removed = 0;
    for (const [mapKey, record] of this.values) {
      if (new Date(now).getTime() >= new Date(record.expiresAt).getTime()) {
        this.values.delete(mapKey);
        removed += 1;
      }
    }
    return removed;
  }
}

export class PostgresExactlyOnceStore implements ExactlyOnceStore {
  private readonly pool: Pool;
  private initialized = false;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS muse_exactly_once_claims (
        company_id TEXT NOT NULL,
        claim_key TEXT NOT NULL,
        draft_id TEXT,
        operation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'in_progress',
        result_json TEXT,
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (company_id, claim_key)
      )
    `);
    this.initialized = true;
  }

  async claim(input: ExactlyOnceClaimInput): Promise<ExactlyOnceClaimResult> {
    const key = requireNonEmpty(input.key, 'muse_exactly_once_key_required');
    const companyId = requireNonEmpty(input.companyId, 'muse_exactly_once_company_required');
    if (input.principal && input.principal.companyId !== companyId) {
      throw new Error('muse_exactly_once_tenant_mismatch');
    }
    const now = nowIso(input.now);
    const ttlMs = input.ttlMs ?? 10 * 60 * 1000;
    const expiresAt = expiresIso(now, ttlMs);
    await this.init();
    // Atomic claim: the PRIMARY KEY makes exactly one of two concurrent
    // inserts win; the loser inserts zero rows and then reads the
    // winner's in-progress row.
    const inserted = await this.pool.query(
      `INSERT INTO muse_exactly_once_claims
         (company_id, claim_key, draft_id, operation, status, expires_at)
       VALUES ($1, $2, $3, $4, 'in_progress', $5)
       ON CONFLICT (company_id, claim_key) DO NOTHING`,
      [companyId, key, input.draftId ?? null, input.operation, expiresAt],
    );
    if ((inserted.rowCount ?? 0) > 0) return { outcome: 'won', expiresAt };
    const existing = await this.pool.query(
      `SELECT status, result_json, expires_at FROM muse_exactly_once_claims
       WHERE company_id = $1 AND claim_key = $2`,
      [companyId, key],
    );
    const row = existing.rows[0];
    if (!row) return { outcome: 'won', expiresAt };
    const record: StoredClaim = {
      companyId, operation: input.operation,
      status: String(row.status) as ExactlyOnceStatus,
      result: row.result_json ? JSON.parse(String(row.result_json)) : undefined,
      claimedAt: now, expiresAt: new Date(String(row.expires_at)).toISOString(),
    };
    return decide(record, input, now) ?? { outcome: 'won', expiresAt };
  }

  async complete(input: { key: string; companyId: string; result: unknown }): Promise<boolean> {
    await this.init();
    const updated = await this.pool.query(
      `UPDATE muse_exactly_once_claims SET status = 'completed', result_json = $3
       WHERE company_id = $1 AND claim_key = $2 AND status = 'in_progress'`,
      [input.companyId, input.key, JSON.stringify(input.result)],
    );
    return (updated.rowCount ?? 0) > 0;
  }

  async release(input: { key: string; companyId: string }): Promise<boolean> {
    await this.init();
    const deleted = await this.pool.query(
      `DELETE FROM muse_exactly_once_claims
       WHERE company_id = $1 AND claim_key = $2 AND status = 'in_progress'`,
      [input.companyId, input.key],
    );
    return (deleted.rowCount ?? 0) > 0;
  }

  async purgeExpired(now: string): Promise<number> {
    await this.init();
    const deleted = await this.pool.query(
      `DELETE FROM muse_exactly_once_claims WHERE expires_at <= $1`,
      [now],
    );
    return deleted.rowCount ?? 0;
  }
}

/** Per-company, per-instance burst limiter. Not a multi-instance limiter. */
export class MuseBurstLimiter {
  private readonly inFlight = new Map<string, number>();
  private readonly queued = new Map<string, number>();

  constructor(
    private readonly maxInFlightPerCompany: number = 50,
    private readonly maxQueuedPerCompany: number = 200,
  ) {}

  tryAdmit(companyId: string): 'admitted' | 'queued' | 'rejected_queue_full' {
    const flying = this.inFlight.get(companyId) ?? 0;
    if (flying < this.maxInFlightPerCompany) {
      this.inFlight.set(companyId, flying + 1);
      return 'admitted';
    }
    const waiting = this.queued.get(companyId) ?? 0;
    if (waiting < this.maxQueuedPerCompany) {
      this.queued.set(companyId, waiting + 1);
      return 'queued';
    }
    return 'rejected_queue_full';
  }

  releaseAdmitted(companyId: string): void {
    const flying = this.inFlight.get(companyId) ?? 0;
    if (flying <= 1) this.inFlight.delete(companyId);
    else this.inFlight.set(companyId, flying - 1);
    const waiting = this.queued.get(companyId) ?? 0;
    if (waiting > 0) {
      this.queued.set(companyId, waiting - 1);
      this.inFlight.set(companyId, (this.inFlight.get(companyId) ?? 0) + 1);
    }
  }

  inFlightCount(companyId: string): number {
    return this.inFlight.get(companyId) ?? 0;
  }
}

/**
 * Run a handler exactly once for a claim. A handler that throws, or
 * reports uncertain, leaves the claim in-progress for reconciliation —
 * it is never auto-retried by this helper.
 */
export async function executeExactlyOnce<T>(
  store: ExactlyOnceStore,
  input: ExactlyOnceClaimInput,
  handler: () => Promise<{ result: T; uncertain?: boolean }>,
): Promise<{ executed: boolean; outcome: ExactlyOnceOutcome; result?: T | unknown }> {
  const claim = await store.claim(input);
  if (claim.outcome !== 'won') {
    return { executed: false, outcome: claim.outcome, result: claim.result };
  }
  const { result, uncertain } = await handler();
  if (uncertain) {
    return { executed: true, outcome: 'stale_reconcile', result };
  }
  await store.complete({ key: input.key, companyId: input.companyId, result });
  return { executed: true, outcome: 'won', result };
}
