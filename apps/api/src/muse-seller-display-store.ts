import type {Pool} from 'pg';
import {
  validateMetaBusinessVerification,
  type BusinessOrigin,
  type MetaBusinessVerification,
} from '@gift-signal/mcp-gateway';
import {
  isValidSellerDisplayName,
  validateSellerDisplayName,
} from './muse-seller-display.js';

/**
 * Persisted, server-owned company seller manifest.
 *
 * This replaces the process-local registry in muse-seller-display.ts as
 * the primary source for host review display names. It follows the
 * existing Postgres store pattern in this service (see
 * provider-readiness-store.ts and provider-transaction-store.ts): the
 * store creates its own table on first use with CREATE TABLE IF NOT
 * EXISTS plus ALTER TABLE ADD COLUMN IF NOT EXISTS, so no separate
 * migration run is required, and infra/db/schema.sql is untouched,
 * exactly as for the readiness and transaction tables.
 *
 * One row per companyId. A display name is only ever stored after
 * validation (never a shop domain or raw account ID), and is
 * re-validated at read time, so a name that would now be rejected
 * (for example because it equals the account ID) never leaks to a
 * review. Origin and metaVerification are stored in the same row
 * because they are the same server-owned enrollment fact: origin is
 * never inferred from a model statement or browser payload, and
 * metaVerification is only stored after validateMetaBusinessVerification
 * accepts it, so self-attestation, model output and browser JSON can
 * never be recorded here. The signed draft state remains the durable
 * fallback for a review: a draft created with a validated display
 * name carries that name in its signed state.
 *
 * There is deliberately no self-attestation recording route for this
 * store. Callers that record origin/metaVerification must be
 * server-side enrollment code, not a browser-submitted payload; the
 * readiness POST route stays 410 for that reason. The readiness
 * service reads a stored record as a fallback when its caller does
 * not supply origin/metaVerification at evaluation time, and still
 * fails closed (CONNECTED for a Meta-origin business) when no valid
 * stored evidence exists.
 */
export interface CompanySellerManifestRecord {
  companyId: string;
  displayName: string | null;
  externalAccountId: string | null;
  origin: BusinessOrigin | null;
  metaVerification: MetaBusinessVerification | null;
  updatedAt: string;
}

export interface CompanySellerManifestStore {
  upsertDisplayName(input: {
    companyId: string;
    displayName: string;
    externalAccountId: string;
  }): Promise<CompanySellerManifestRecord>;
  upsertMetaVerification(input: {
    companyId: string;
    origin: BusinessOrigin;
    metaVerification: MetaBusinessVerification;
  }): Promise<CompanySellerManifestRecord>;
  get(companyId: string): Promise<CompanySellerManifestRecord | null>;
}

function isBusinessOrigin(value: unknown): value is BusinessOrigin {
  return value === 'meta' || value === 'non-meta';
}

function parseMetaVerification(value: unknown): MetaBusinessVerification | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as MetaBusinessVerification;
}

function rowToRecord(row: any): CompanySellerManifestRecord {
  return {
    companyId: String(row.company_id),
    displayName:
      row.display_name === null || row.display_name === undefined
        ? null
        : String(row.display_name),
    externalAccountId:
      row.external_account_id === null || row.external_account_id === undefined
        ? null
        : String(row.external_account_id),
    origin: isBusinessOrigin(row.origin) ? row.origin : null,
    metaVerification: parseMetaVerification(row.meta_verification),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class PostgresCompanySellerManifestStore
  implements CompanySellerManifestStore
{
  private initialized = false;
  constructor(private readonly pool: Pool) {}

  private async init() {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS company_seller_manifests (
        company_id TEXT NOT NULL PRIMARY KEY,
        display_name TEXT,
        external_account_id TEXT,
        origin TEXT,
        meta_verification JSONB,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(
      `ALTER TABLE company_seller_manifests ADD COLUMN IF NOT EXISTS display_name TEXT`
    );
    await this.pool.query(
      `ALTER TABLE company_seller_manifests ADD COLUMN IF NOT EXISTS external_account_id TEXT`
    );
    await this.pool.query(
      `ALTER TABLE company_seller_manifests ADD COLUMN IF NOT EXISTS origin TEXT`
    );
    await this.pool.query(
      `ALTER TABLE company_seller_manifests ADD COLUMN IF NOT EXISTS meta_verification JSONB`
    );
    this.initialized = true;
  }

  async upsertDisplayName(input: {
    companyId: string;
    displayName: string;
    externalAccountId: string;
  }): Promise<CompanySellerManifestRecord> {
    const validated = validateSellerDisplayName(
      input.displayName,
      input.externalAccountId
    );
    await this.init();
    const result = await this.pool.query(
      `INSERT INTO company_seller_manifests
       (company_id, display_name, external_account_id, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (company_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       external_account_id = EXCLUDED.external_account_id,
       updated_at = now()
       RETURNING *`,
      [input.companyId, validated, input.externalAccountId]
    );
    if (!result.rows[0]) throw new Error('seller_manifest_upsert_failed');
    return rowToRecord(result.rows[0]);
  }

  async upsertMetaVerification(input: {
    companyId: string;
    origin: BusinessOrigin;
    metaVerification: MetaBusinessVerification;
  }): Promise<CompanySellerManifestRecord> {
    if (!isBusinessOrigin(input.origin)) {
      throw new Error('seller_manifest_origin_invalid');
    }
    if (!validateMetaBusinessVerification(input.metaVerification).valid) {
      throw new Error('meta_business_verification_required');
    }
    await this.init();
    const result = await this.pool.query(
      `INSERT INTO company_seller_manifests
       (company_id, origin, meta_verification, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (company_id) DO UPDATE SET
       origin = EXCLUDED.origin,
       meta_verification = EXCLUDED.meta_verification,
       updated_at = now()
       RETURNING *`,
      [input.companyId, input.origin, JSON.stringify(input.metaVerification)]
    );
    if (!result.rows[0]) throw new Error('seller_manifest_upsert_failed');
    return rowToRecord(result.rows[0]);
  }

  async get(companyId: string): Promise<CompanySellerManifestRecord | null> {
    await this.init();
    const result = await this.pool.query(
      `SELECT * FROM company_seller_manifests WHERE company_id = $1`,
      [companyId]
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }
}

/**
 * Host display-name resolver backed by the persisted store first.
 *
 * Order: (1) persisted store, re-validated at read time against the
 * stored external account ID; (2) the supplied fallback resolver
 * (the legacy process-local registry when one is configured, which
 * itself re-validates at read time); (3) nothing — callers fail
 * closed with muse_review_seller_display_required. A name is never
 * derived from a shop domain or raw account ID, and a stored name
 * belonging to another company is never returned, because lookup is
 * strictly by the requested companyId.
 */
export function createPersistedSellerDisplayResolver(
  store: Pick<CompanySellerManifestStore, 'get'> | null,
  fallback?: (companyId: string) => Promise<string | null>,
  externalAccountIdForCompany?: (companyId: string) => string | undefined
): (companyId: string) => Promise<string | null> {
  return async (companyId: string) => {
    if (store) {
      const record = await store.get(companyId);
      if (record?.displayName) {
        const externalAccountId =
          record.externalAccountId ??
          externalAccountIdForCompany?.(companyId) ??
          '';
        if (isValidSellerDisplayName(record.displayName, externalAccountId)) {
          return record.displayName.trim();
        }
        // A stored name that no longer validates must not leak, and
        // must not shadow a valid fallback: fall through.
      }
    }
    return fallback ? fallback(companyId) : null;
  };
}
