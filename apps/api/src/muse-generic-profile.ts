import type {Pool} from 'pg';
import {verifyDraft, type SignedDraftEnvelope} from '@gift-signal/zero-trust';
import type {ConnectorActionDraft} from '@gift-signal/mcp-gateway';
import type {ZeroTrustConnectorRuntime} from '@gift-signal/mcp-gateway';
import type {MuseGenericExecutionResult} from './muse-agent-host.js';

/**
 * Production company -> generic execution profile registry.
 *
 * This is the piece that was missing in apps/api/src/index.ts: the
 * Muse host already supported a generic (rail-independent) profile
 * through injected dependencies, but index.ts never supplied them,
 * so every company silently fell back to the reference
 * (Stripe/Shopify) path.
 *
 * Registration is explicit and server-owned, never inferred:
 * - A company registers its own profile only, through an
 *   authenticated company principal (principal.orgId). A body
 *   companyId that differs from the principal is rejected by the
 *   route; no name, domain, shop, or model output is ever used to
 *   classify a company.
 * - The profile records an evidence reference (a server-side
 *   enrollment/connector record, e.g. an OAuth connection or a
 *   trusted onboarding record), not a self-assertion. Placeholder
 *   values are rejected.
 * - The synthetic fixture (services/mcp-gateway/src/
 *   synthetic-fixture-connector.ts, companyId
 *   'synthetic-fixture-demo-only') is NEVER registered here: its
 *   register path rejects that companyId, and index.ts never
 *   registers any adapter for it in production. It remains
 *   test-only.
 *
 * What registration does and does not enable:
 * - It makes resolveExecutionProfile return 'generic' for that
 *   company, and makes genericReadiness true, so the host takes
 *   the generic branch with its exact approval, consume-once,
 *   drift revalidation, single execution claim, and
 *   uncertain -> reconciliation_required behaviour (all enforced
 *   inside ZeroTrustConnectorRuntime, never retried by the host).
 * - It does NOT, by itself, commit anything: execution still
 *   requires a connector adapter registered in-process by the
 *   server operator (ZeroTrustConnectorRegistry). Adapters are
 *   never registered over HTTP. Without a registered adapter,
 *   submitGeneric fails closed with
 *   muse_generic_connector_not_registered, and no approval is
 *   consumed. That is the correct outcome for a registered
 *   profile whose provider integration has not yet been wired
 *   by the operator.
 * - Generic drafts are the signed ConnectorActionDraft envelopes
 *   already stored by ZeroTrustConnectorRuntime (table
 *   connector_drafts, via PostgresZeroTrustAuthority), so no
 *   second draft store is invented: genericDraft verifies the
 *   envelope signature, checks company/connection scope, and
 *   returns only the facts the host needs.
 */

export const SYNTHETIC_FIXTURE_COMPANY_ID = 'synthetic-fixture-demo-only';

export interface CompanyGenericProfile {
  companyId: string;
  evidenceRef: string;
  registeredBy: string;
  registeredAt: string;
}

export interface CompanyGenericProfileStore {
  register(input: {
    companyId: string;
    evidenceRef: string;
    registeredBy: string;
  }): Promise<CompanyGenericProfile>;
  get(companyId: string): Promise<CompanyGenericProfile | null>;
  deactivate(companyId: string): Promise<boolean>;
}

const PLACEHOLDER_EVIDENCE = new Set([
  '',
  'placeholder',
  'todo',
  'tbd',
  'test',
  'demo',
  'xxx',
  'none',
  'null',
]);

export function validateGenericProfileRegistration(input: {
  companyId: string;
  evidenceRef: unknown;
  registeredBy: string;
  principalOrgId: string;
}): {companyId: string; evidenceRef: string; registeredBy: string} {
  if (typeof input.companyId !== 'string' || !input.companyId.trim()) {
    throw new Error('generic_profile_company_id_invalid');
  }
  const companyId = input.companyId.trim();
  if (companyId !== input.principalOrgId) {
    throw new Error('generic_profile_company_mismatch');
  }
  if (companyId === SYNTHETIC_FIXTURE_COMPANY_ID) {
    throw new Error('generic_profile_synthetic_fixture_not_registerable');
  }
  if (typeof input.evidenceRef !== 'string') {
    throw new Error('generic_profile_evidence_ref_invalid');
  }
  const evidenceRef = input.evidenceRef.trim();
  if (
    !evidenceRef ||
    evidenceRef.length > 500 ||
    PLACEHOLDER_EVIDENCE.has(evidenceRef.toLowerCase())
  ) {
    throw new Error('generic_profile_evidence_ref_invalid');
  }
  if (typeof input.registeredBy !== 'string' || !input.registeredBy.trim()) {
    throw new Error('generic_profile_registered_by_invalid');
  }
  return {companyId, evidenceRef, registeredBy: input.registeredBy.trim()};
}

export class MemoryCompanyGenericProfileStore
  implements CompanyGenericProfileStore
{
  private readonly values = new Map<string, CompanyGenericProfile>();
  async register(input: {
    companyId: string;
    evidenceRef: string;
    registeredBy: string;
  }): Promise<CompanyGenericProfile> {
    const profile: CompanyGenericProfile = {
      companyId: input.companyId,
      evidenceRef: input.evidenceRef,
      registeredBy: input.registeredBy,
      registeredAt: new Date().toISOString(),
    };
    this.values.set(input.companyId, profile);
    return {...profile};
  }
  async get(companyId: string): Promise<CompanyGenericProfile | null> {
    const value = this.values.get(companyId);
    return value ? {...value} : null;
  }
  async deactivate(companyId: string): Promise<boolean> {
    return this.values.delete(companyId);
  }
}

export class PostgresCompanyGenericProfileStore
  implements CompanyGenericProfileStore
{
  private initialized = false;
  constructor(private readonly pool: Pool) {}
  private async init() {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS company_generic_profiles (
        company_id TEXT NOT NULL PRIMARY KEY,
        evidence_ref TEXT NOT NULL,
        registered_by TEXT NOT NULL,
        registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(
      `ALTER TABLE company_generic_profiles ADD COLUMN IF NOT EXISTS evidence_ref TEXT`
    );
    await this.pool.query(
      `ALTER TABLE company_generic_profiles ADD COLUMN IF NOT EXISTS registered_by TEXT`
    );
    await this.pool.query(
      `ALTER TABLE company_generic_profiles ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ`
    );
    this.initialized = true;
  }
  async register(input: {
    companyId: string;
    evidenceRef: string;
    registeredBy: string;
  }): Promise<CompanyGenericProfile> {
    await this.init();
    const result = await this.pool.query(
      `INSERT INTO company_generic_profiles
       (company_id, evidence_ref, registered_by, registered_at, updated_at)
       VALUES ($1, $2, $3, now(), now())
       ON CONFLICT (company_id) DO UPDATE SET
       evidence_ref = EXCLUDED.evidence_ref,
       registered_by = EXCLUDED.registered_by,
       updated_at = now()
       RETURNING company_id, evidence_ref, registered_by, registered_at`,
      [input.companyId, input.evidenceRef, input.registeredBy]
    );
    if (!result.rows[0]) throw new Error('generic_profile_register_failed');
    const row = result.rows[0];
    return {
      companyId: String(row.company_id),
      evidenceRef: String(row.evidence_ref),
      registeredBy: String(row.registered_by),
      registeredAt: new Date(row.registered_at).toISOString(),
    };
  }
  async get(companyId: string): Promise<CompanyGenericProfile | null> {
    await this.init();
    const result = await this.pool.query(
      `SELECT company_id, evidence_ref, registered_by, registered_at FROM company_generic_profiles WHERE company_id = $1`,
      [companyId]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      companyId: String(row.company_id),
      evidenceRef: String(row.evidence_ref),
      registeredBy: String(row.registered_by),
      registeredAt: new Date(row.registered_at).toISOString(),
    };
  }
  async deactivate(companyId: string): Promise<boolean> {
    await this.init();
    const result = await this.pool.query(
      `DELETE FROM company_generic_profiles WHERE company_id = $1`,
      [companyId]
    );
    return (result.rowCount ?? 0) === 1;
  }
}

/** Host profile resolver: registered generic profile -> 'generic', otherwise the reference path. */
export function createGenericProfileResolver(
  store: Pick<CompanyGenericProfileStore, 'get'> | null
): (args: {
  companyId: string;
  connectionId: string;
  draftId: string;
}) => Promise<'reference' | 'generic'> {
  return async ({companyId}) => {
    if (!store) return 'reference';
    try {
      return (await store.get(companyId)) ? 'generic' : 'reference';
    } catch {
      throw new Error('generic_profile_store_unavailable');
    }
  };
}

/** Generic readiness gate: only an explicitly registered profile is ready. */
export function createGenericReadiness(
  store: Pick<CompanyGenericProfileStore, 'get'> | null
): (companyId: string) => Promise<boolean> {
  return async (companyId: string) => {
    if (!store) return false;
    return Boolean(await store.get(companyId));
  };
}

export type GenericDraftAuthority = {
  get(
    draftId: string
  ): Promise<SignedDraftEnvelope<ConnectorActionDraft> | null>;
};

/** Host genericDraft resolver: verified signed envelope, scope-checked, facts only. */
export function createGenericDraftResolver(
  drafts: GenericDraftAuthority | null,
  draftSigningSecret: string
): (args: {
  companyId: string;
  connectionId: string;
  draftId: string;
}) => Promise<{
  draftHash: string;
  total: number;
  currency: string;
  expiresAt: string;
} | null> {
  return async ({companyId, connectionId, draftId}) => {
    if (!drafts || !draftSigningSecret) return null;
    const envelope = await drafts.get(draftId);
    if (!envelope) return null;
    const verified = verifyDraft(envelope, draftSigningSecret);
    if (!verified.ok) return null;
    const draft = verified.payload;
    if (draft.companyId !== companyId || draft.connectionId !== connectionId) {
      return null;
    }
    return {
      draftHash: verified.payloadHash,
      total: draft.total,
      currency: draft.currency,
      expiresAt: draft.expiresAt,
    };
  };
}

/** Host submitGeneric: delegates to ZeroTrustConnectorRuntime; maps its result, never retries. */
export function createGenericSubmit(
  runtime: Pick<
    ZeroTrustConnectorRuntime,
    'execute'
  > | null
): (args: {
  subjectId: string;
  consumerEmail?: string;
  companyId: string;
  connectionId: string;
  draftId: string;
  approvalToken: string;
}) => Promise<MuseGenericExecutionResult> {
  return async (args) => {
    if (!runtime) throw new Error('muse_generic_connector_not_registered');
    let execution: Awaited<ReturnType<ZeroTrustConnectorRuntime['execute']>>;
    try {
      execution = await runtime.execute(args.companyId, args.connectionId, {
        draftId: args.draftId,
        approvalToken: args.approvalToken,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /unknown_company_connector/.test(error.message)
      ) {
        throw new Error('muse_generic_connector_not_registered');
      }
      throw error;
    }
    if (!execution || execution.status === 'CONFIRMED') {
      return {
        status: 'CONFIRMED',
        ...(execution?.executionId ? {executionId: execution.executionId} : {}),
        ...(execution?.providerReference
          ? {providerReference: execution.providerReference}
          : {}),
      };
    }
    if (execution.status === 'FAILED') {
      return {
        status: 'FAILED',
        ...(execution.executionId ? {executionId: execution.executionId} : {}),
        ...(execution.providerReference
          ? {providerReference: execution.providerReference}
          : {}),
      };
    }
    return {
      status: 'UNCERTAIN',
      ...(execution.executionId ? {executionId: execution.executionId} : {}),
    };
  };
}
