import { createHash } from 'node:crypto';

/**
 * Muse Business Intelligence — secondary demo, AdJudge guardrails ported
 * as TypeScript contracts (not Python code verbatim).
 *
 * READ FIRST — what this module is and is not:
 * - It is READ-ONLY reporting over SUPPLIED / DEMO events only. There is
 *   no live Meta ad ingestion here, no live Shop/Meta/payment claim, and
 *   no campaign, budget, routing, ranking, or policy change from BI.
 *   Every report is labeled "DEMO/SUPPLIED EVENTS" everywhere it is shown.
 * - BI GATE (1) and (2) from the AdJudge spec are in this file, and no
 *   report may be presented as a current claim until both pass:
 *   (1) every metric-bearing report carries definition name + version,
 *   source/version, computed_at, freshness SLA, code version, input hash,
 *   and verification status (verified | stale | unverifiable).
 *   assertVerifiedForCurrentClaim() blocks stale/unverifiable from
 *   current claims; stale may only be shown labeled "stale".
 *   (2) tenant trimming happens at the BI query layer BEFORE
 *   aggregation. The company ID comes from the authenticated principal
 *   (principalCompanyId), never from a request query/body parameter:
 *   a caller-supplied attemptedCompanyId that differs from the
 *   principal fails closed with bi_tenant_mismatch, and an empty
 *   principal fails closed with bi_principal_required.
 * - Attribution rules, stated in code and in docs/muse-bi.md:
 *   attribution window is 30 days (ATTRIBUTION_WINDOW_DAYS); one outcome
 *   is attributed once per draftId (later verified outcomes for the
 *   same draft are duplicates, not new revenue); refunds and
 *   cancellations adjust revenue (a cancelled outcome contributes 0,
 *   a refunded amount is subtracted); organic vs paid is set at event
 *   creation — a campaign ID present means paid, absent means organic —
 *   and is never inferred or rewritten later.
 * - Watermark/freshness: applyBiIngestionResult() advances a
 *   per-metric/per-company watermark ONLY on a successful, verified
 *   ingestion. On failure it does NOT advance, retains the last
 *   verified artifact, and subsequent output is stale/unverifiable.
 *   Data-contract failures never silently publish replacements.
 * - Forensics/remediation: a timeline keyed by draftId carries evidence
 *   refs (draftId, approval JTI/hash, transaction/order refs,
 *   timestamps). Remediation proposals for RECONCILE_REQUIRED are
 *   proposals only — each carries risk, rollback, owner, and measurable
 *   success criteria, requires human approval before execution, and
 *   NEVER auto-retries a payment. There is deliberately no execute
 *   function for a remediation proposal in this module.
 * - Explicitly NOT ported: creative-quality scores, the AdControlCenter
 *   dataset, any creative-label -> purchase prediction, auto_approve
 *   for payments, and live Meta ad reporting.
 */

export const BI_CODE_VERSION = 'muse-bi-1';
export const BI_DATA_SOURCE_LABEL = 'DEMO/SUPPLIED EVENTS';
/** Attribution window, stated — not left implicit. */
export const ATTRIBUTION_WINDOW_DAYS = 30;
export const ATTRIBUTION_WINDOW_MS = ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const DEFAULT_FRESHNESS_SLA_MS = 24 * 60 * 60 * 1000;

export type BiVerificationStatus = 'verified' | 'stale' | 'unverifiable';

export const APPROVED_BI_METRICS = [
  'funnel_counts',
  'funnel_conversion',
  'verified_orders',
  'attributed_revenue',
  'roas',
] as const;
export type BiMetric = (typeof APPROVED_BI_METRICS)[number];

export const APPROVED_BI_DIMENSIONS = [
  'campaignId',
  'reelId',
  'acquisition',
  'paymentVehicle',
] as const;
export type BiDimension = (typeof APPROVED_BI_DIMENSIONS)[number];

export const BI_METRIC_DEFINITIONS: Record<BiMetric, { name: string; version: string; description: string }> = {
  funnel_counts: { name: 'funnel_counts', version: '1', description: 'Count of funnel events per stage, after tenant trimming and before no other aggregation.' },
  funnel_conversion: { name: 'funnel_conversion', version: '1', description: 'Attributed verified outcomes divided by intent events, per draft-attribution rules (30-day window, one outcome per draft).' },
  verified_orders: { name: 'verified_orders', version: '1', description: 'Count of attributed verified outcomes (one per draftId, within the 30-day window).' },
  attributed_revenue: { name: 'attributed_revenue', version: '1', description: 'Sum of attributed outcome amounts, minus refunds, with cancelled outcomes contributing 0.' },
  roas: { name: 'roas', version: '1', description: 'Attributed revenue divided by supplied spend. Unverifiable when spend is not supplied for an attributed campaign — spend is never invented.' },
};

export interface BiProvenance {
  definitionName: string;
  definitionVersion: string;
  source: string;
  sourceVersion: string;
  computedAt: string;
  freshnessSlaMs: number;
  codeVersion: string;
  inputHash: string;
  verificationStatus: BiVerificationStatus;
  dataSourceLabel: typeof BI_DATA_SOURCE_LABEL;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function computeBiInputHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function evaluateBiVerification(args: {
  computedAt: string;
  now?: Date;
  freshnessSlaMs: number;
  sourceValid: boolean;
  expectedInputHash?: string;
  actualInputHash: string;
}): BiVerificationStatus {
  if (!args.sourceValid) return 'unverifiable';
  if (args.expectedInputHash !== undefined && args.expectedInputHash !== args.actualInputHash) return 'unverifiable';
  const computedMs = new Date(args.computedAt).getTime();
  if (!Number.isFinite(computedMs)) return 'unverifiable';
  const nowMs = (args.now ?? new Date()).getTime();
  if (nowMs - computedMs > args.freshnessSlaMs) return 'stale';
  return 'verified';
}

export function buildBiProvenance(args: {
  metric: BiMetric;
  source?: string;
  sourceVersion?: string;
  computedAt?: string;
  freshnessSlaMs?: number;
  inputHash: string;
  verificationStatus: BiVerificationStatus;
}): BiProvenance {
  const definition = BI_METRIC_DEFINITIONS[args.metric];
  return {
    definitionName: definition.name,
    definitionVersion: definition.version,
    source: args.source ?? 'supplied-events',
    sourceVersion: args.sourceVersion ?? '1',
    computedAt: args.computedAt ?? new Date().toISOString(),
    freshnessSlaMs: args.freshnessSlaMs ?? DEFAULT_FRESHNESS_SLA_MS,
    codeVersion: BI_CODE_VERSION,
    inputHash: args.inputHash,
    verificationStatus: args.verificationStatus,
    dataSourceLabel: BI_DATA_SOURCE_LABEL,
  };
}

/** BI GATE (1): blocks stale/unverifiable from current factual claims. */
export function assertVerifiedForCurrentClaim(provenance: BiProvenance): void {
  if (provenance.verificationStatus === 'stale') throw new Error('bi_metric_stale');
  if (provenance.verificationStatus === 'unverifiable') throw new Error('bi_metric_unverifiable');
}

/** A stale report may only be shown with this label, never as current. */
export function biStatusLabel(status: BiVerificationStatus): string {
  return status === 'verified' ? 'current' : status === 'stale' ? 'stale' : 'unverifiable';
}

export type BiFunnelStage = 'intent' | 'review' | 'approval' | 'transaction' | 'verified_outcome';
export const BI_FUNNEL_STAGES: BiFunnelStage[] = ['intent', 'review', 'approval', 'transaction', 'verified_outcome'];
export type BiAcquisition = 'paid' | 'organic';

export interface BiFunnelEventInput {
  companyId: string;
  draftId: string;
  campaignId?: string;
  reelId?: string;
  stage: BiFunnelStage;
  occurredAt: string;
  amount?: number;
  currency?: string;
  refundAmount?: number;
  cancelled?: boolean;
  paymentVehicle?: 'stripe' | 'shop_pay';
  origin?: 'meta' | 'non-meta' | 'unknown';
  outcomeRef?: string;
  transactionRef?: string;
  orderRef?: string;
  approvalJti?: string;
  approvalHash?: string;
  /** If supplied, it must agree with campaign presence (see below). */
  acquisition?: BiAcquisition;
}

export interface BiFunnelEvent extends Required<Pick<BiFunnelEventInput, 'companyId' | 'draftId' | 'stage' | 'occurredAt' | 'acquisition'>> {
  campaignId: string | null;
  reelId: string | null;
  amount: number | null;
  currency: string | null;
  refundAmount: number;
  cancelled: boolean;
  paymentVehicle: 'stripe' | 'shop_pay' | null;
  origin: 'meta' | 'non-meta' | 'unknown';
  outcomeRef: string | null;
  transactionRef: string | null;
  orderRef: string | null;
  approvalJti: string | null;
  approvalHash: string | null;
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`bi_event_${field}_invalid`);
  return value.trim();
}
function optionalBounded(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`bi_event_${field}_invalid`);
  return value.trim();
}

/**
 * Validates and stamps a funnel event. Organic vs paid is set HERE, at
 * creation, from campaign presence — and never inferred later: query
 * code reads event.acquisition, it does not recompute it.
 */
export function recordBiFunnelEvent(input: BiFunnelEventInput): BiFunnelEvent {
  const companyId = boundedString(input.companyId, 'company_id', 160);
  const draftId = boundedString(input.draftId, 'draft_id', 160);
  if (!BI_FUNNEL_STAGES.includes(input.stage)) throw new Error('bi_event_stage_invalid');
  const occurredMs = new Date(input.occurredAt).getTime();
  if (!Number.isFinite(occurredMs)) throw new Error('bi_event_occurred_at_invalid');
  const campaignId = optionalBounded(input.campaignId, 'campaign_id', 160);
  const reelId = optionalBounded(input.reelId, 'reel_id', 160);
  const acquisition: BiAcquisition = campaignId ? 'paid' : 'organic';
  if (input.acquisition !== undefined && input.acquisition !== acquisition) {
    throw new Error('bi_supplied_acquisition_mismatch');
  }
  if (input.amount !== undefined && (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount < 0)) {
    throw new Error('bi_event_amount_invalid');
  }
  if (input.currency !== undefined && (typeof input.currency !== 'string' || input.currency.length !== 3)) {
    throw new Error('bi_event_currency_invalid');
  }
  if (input.refundAmount !== undefined && (typeof input.refundAmount !== 'number' || !Number.isFinite(input.refundAmount) || input.refundAmount < 0)) {
    throw new Error('bi_event_refund_invalid');
  }
  if (input.paymentVehicle !== undefined && input.paymentVehicle !== 'stripe' && input.paymentVehicle !== 'shop_pay') {
    throw new Error('bi_event_payment_vehicle_invalid');
  }
  if (input.origin !== undefined && !['meta', 'non-meta', 'unknown'].includes(input.origin)) {
    throw new Error('bi_event_origin_invalid');
  }
  return {
    companyId,
    draftId,
    campaignId,
    reelId,
    stage: input.stage,
    occurredAt: new Date(occurredMs).toISOString(),
    acquisition,
    amount: input.amount ?? null,
    currency: input.currency ?? null,
    refundAmount: input.refundAmount ?? 0,
    cancelled: input.cancelled === true,
    paymentVehicle: input.paymentVehicle ?? null,
    origin: input.origin ?? 'unknown',
    outcomeRef: optionalBounded(input.outcomeRef, 'outcome_ref', 240),
    transactionRef: optionalBounded(input.transactionRef, 'transaction_ref', 240),
    orderRef: optionalBounded(input.orderRef, 'order_ref', 240),
    approvalJti: optionalBounded(input.approvalJti, 'approval_jti', 240),
    approvalHash: optionalBounded(input.approvalHash, 'approval_hash', 128),
  };
}

/** Parses supplied/demo JSON into validated events (acquisition stamped at parse time). */
export function parseSuppliedBiEvents(value: unknown): BiFunnelEvent[] {
  if (!Array.isArray(value)) throw new Error('bi_supplied_events_invalid');
  if (value.length > 10000) throw new Error('bi_supplied_events_too_large');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('bi_supplied_events_invalid');
    return recordBiFunnelEvent(item as BiFunnelEventInput);
  });
}

export function parseBiDemoEventsEnv(raw: string | undefined): BiFunnelEvent[] {
  if (!raw || !raw.trim()) throw new Error('muse_bi_demo_events_not_configured');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('bi_supplied_events_invalid'); }
  return parseSuppliedBiEvents(parsed);
}

export interface BiEventStore {
  record(event: BiFunnelEvent): Promise<BiFunnelEvent>;
  list(companyId: string): Promise<BiFunnelEvent[]>;
  listForDraft(companyId: string, draftId: string): Promise<BiFunnelEvent[]>;
}

export class InMemoryBiEventStore implements BiEventStore {
  private readonly events: BiFunnelEvent[] = [];
  private readonly watermarks = new Map<string, BiWatermark>();
  async record(event: BiFunnelEvent): Promise<BiFunnelEvent> {
    this.events.push({ ...event });
    return { ...event };
  }
  async list(companyId: string): Promise<BiFunnelEvent[]> {
    // Tenant trimming: filter by companyId here, before any aggregation.
    return this.events.filter((event) => event.companyId === companyId).map((event) => ({ ...event }));
  }
  async listForDraft(companyId: string, draftId: string): Promise<BiFunnelEvent[]> {
    return this.events
      .filter((event) => event.companyId === companyId && event.draftId === draftId)
      .map((event) => ({ ...event }));
  }
  getWatermark(metric: BiMetric, companyId: string): BiWatermark | null {
    return this.watermarks.get(`${metric}|${companyId}`) ?? null;
  }
  setWatermark(watermark: BiWatermark): void {
    this.watermarks.set(`${watermark.metric}|${watermark.companyId}`, { ...watermark });
  }
}

export interface BiWatermark {
  metric: BiMetric;
  companyId: string;
  lastVerifiedAt: string;
  inputHash: string;
  artifactId: string;
}

export interface BiWatermarkStore {
  getWatermark(metric: BiMetric, companyId: string): Promise<BiWatermark | null> | BiWatermark | null;
  setWatermark(watermark: BiWatermark): Promise<void> | void;
}

/**
 * Watermark/freshness refresh. Advances ONLY on a successful, verified
 * ingestion. On failure the watermark is NOT advanced, the last verified
 * artifact is retained, and the caller must label output stale (when a
 * prior artifact exists) or unverifiable (when none exists).
 */
export async function applyBiIngestionResult(args: {
  store: BiWatermarkStore;
  metric: BiMetric;
  companyId: string;
  ok: boolean;
  computedAt?: string;
  inputHash?: string;
  artifactId?: string;
}): Promise<{ advanced: boolean; retained: BiWatermark | null; status: BiVerificationStatus }> {
  const retained = (await args.store.getWatermark(args.metric, args.companyId)) ?? null;
  if (!args.ok || !args.computedAt || !args.inputHash || !args.artifactId) {
    return { advanced: false, retained, status: retained ? 'stale' : 'unverifiable' };
  }
  const watermark: BiWatermark = {
    metric: args.metric,
    companyId: args.companyId,
    lastVerifiedAt: args.computedAt,
    inputHash: args.inputHash,
    artifactId: args.artifactId,
  };
  await args.store.setWatermark(watermark);
  return { advanced: true, retained: watermark, status: 'verified' };
}

export interface AttributedBiOutcome {
  event: BiFunnelEvent;
  attributed: boolean;
  reason: 'attributed' | 'duplicate_outcome_for_draft' | 'outside_attribution_window' | 'no_intent_for_draft';
  netAmount: number;
}

/**
 * Attribution, in code: one outcome attributed once per draftId, and
 * only when a verified outcome falls within 30 days after that draft's
 * first intent. Refunds subtract; cancellations contribute 0.
 */
export function attributeBiOutcomes(events: BiFunnelEvent[]): AttributedBiOutcome[] {
  const firstIntent = new Map<string, number>();
  for (const event of events) {
    if (event.stage !== 'intent') continue;
    const ms = new Date(event.occurredAt).getTime();
    if (!firstIntent.has(event.draftId) || ms < (firstIntent.get(event.draftId) ?? Infinity)) firstIntent.set(event.draftId, ms);
  }
  const attributedDrafts = new Set<string>();
  return events
    .filter((event) => event.stage === 'verified_outcome')
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
    .map((event) => {
      const netAmount = event.cancelled ? 0 : Math.max(0, (event.amount ?? 0) - event.refundAmount);
      const intentMs = firstIntent.get(event.draftId);
      if (intentMs === undefined) return { event, attributed: false, reason: 'no_intent_for_draft' as const, netAmount };
      const outcomeMs = new Date(event.occurredAt).getTime();
      if (outcomeMs < intentMs || outcomeMs - intentMs > ATTRIBUTION_WINDOW_MS) {
        return { event, attributed: false, reason: 'outside_attribution_window' as const, netAmount };
      }
      if (attributedDrafts.has(event.draftId)) {
        return { event, attributed: false, reason: 'duplicate_outcome_for_draft' as const, netAmount };
      }
      attributedDrafts.add(event.draftId);
      return { event, attributed: true, reason: 'attributed' as const, netAmount };
    });
}

function dimensionValue(event: BiFunnelEvent, dimension: BiDimension): string {
  switch (dimension) {
    case 'campaignId': return event.campaignId ?? '(none)';
    case 'reelId': return event.reelId ?? '(none)';
    case 'acquisition': return event.acquisition;
    case 'paymentVehicle': return event.paymentVehicle ?? '(none)';
  }
}

export interface BiReport {
  dataSourceLabel: typeof BI_DATA_SOURCE_LABEL;
  demoLabel: string;
  companyId: string;
  tenantFilteredBeforeAggregation: true;
  metric: BiMetric;
  dimensions: BiDimension[];
  provenance: BiProvenance;
  data: unknown;
}

/**
 * BI GATE (2) + query layer. Tenant trimming is the FIRST step, before
 * any counting or summing. Unknown metrics/dimensions are rejected,
 * never answered with a fallback query. Company ID comes only from
 * principalCompanyId.
 */
export function queryBiReport(args: {
  principalCompanyId: string;
  attemptedCompanyId?: string;
  metric: string;
  dimensions?: string[];
  events: BiFunnelEvent[];
  spendByCampaign?: Record<string, number>;
  computedAt?: string;
  freshnessSlaMs?: number;
  sourceVersion?: string;
  now?: Date;
}): BiReport {
  const principalCompanyId = args.principalCompanyId?.trim();
  if (!principalCompanyId) throw new Error('bi_principal_required');
  if (args.attemptedCompanyId !== undefined && args.attemptedCompanyId.trim() !== principalCompanyId) {
    throw new Error('bi_tenant_mismatch');
  }
  if (!(APPROVED_BI_METRICS as readonly string[]).includes(args.metric)) throw new Error('bi_metric_not_approved');
  const metric = args.metric as BiMetric;
  const dimensions: BiDimension[] = [];
  for (const dimension of args.dimensions ?? []) {
    if (!(APPROVED_BI_DIMENSIONS as readonly string[]).includes(dimension)) throw new Error('bi_dimension_not_approved');
    dimensions.push(dimension as BiDimension);
  }
  // Tenant trimming BEFORE aggregation — everything below sees only
  // this company's events.
  const tenantEvents = args.events.filter((event) => event.companyId === principalCompanyId);
  const computedAt = args.computedAt ?? new Date().toISOString();
  const freshnessSlaMs = args.freshnessSlaMs ?? DEFAULT_FRESHNESS_SLA_MS;
  const inputHash = computeBiInputHash({ metric, dimensions, events: tenantEvents, spendByCampaign: args.spendByCampaign ?? null });
  let data: unknown;
  let sourceValid = true;
  if (metric === 'funnel_counts') {
    const counts = new Map<string, Record<string, number>>();
    for (const event of tenantEvents) {
      const key = dimensions.map((d) => dimensionValue(event, d)).join('|') || '(all)';
      const row = counts.get(key) ?? Object.fromEntries(BI_FUNNEL_STAGES.map((stage) => [stage, 0]));
      row[event.stage] = (row[event.stage] ?? 0) + 1;
      counts.set(key, row);
    }
    data = [...counts.entries()].map(([group, stages]) => ({
      group: Object.fromEntries(dimensions.map((d, i) => [d, group.split('|')[i]])),
      stages,
    }));
  } else if (metric === 'funnel_conversion' || metric === 'verified_orders' || metric === 'attributed_revenue' || metric === 'roas') {
    const attributed = attributeBiOutcomes(tenantEvents);
    const attributedEvents = attributed.filter((item) => item.attributed);
    const intentCount = tenantEvents.filter((event) => event.stage === 'intent').length;
    const revenue = attributedEvents.reduce((sum, item) => sum + item.netAmount, 0);
    if (metric === 'funnel_conversion') {
      data = { intentCount, verifiedOutcomeCount: attributedEvents.length, conversion: intentCount === 0 ? null : attributedEvents.length / intentCount };
    } else if (metric === 'verified_orders') {
      data = { verifiedOutcomeCount: attributedEvents.length };
    } else if (metric === 'attributed_revenue') {
      data = { attributedRevenue: revenue, attributedOutcomeCount: attributedEvents.length };
    } else {
      const spendByCampaign = args.spendByCampaign ?? {};
      const campaigns = new Set(attributedEvents.map((item) => item.event.campaignId).filter((id): id is string => id !== null));
      const missingSpend = [...campaigns].some((id) => typeof spendByCampaign[id] !== 'number' || !Number.isFinite(spendByCampaign[id]));
      const totalSpend = [...campaigns].reduce((sum, id) => sum + (spendByCampaign[id] ?? 0), 0);
      // ROAS uses paid attributed revenue only: organic outcomes have
      // no campaign spend, so including them would inflate ROAS.
      const paidRevenue = attributedEvents
        .filter((item) => item.event.campaignId !== null)
        .reduce((sum, item) => sum + item.netAmount, 0);
      if (missingSpend || totalSpend <= 0) {
        sourceValid = false;
        data = { roas: null, reason: 'roas_spend_not_supplied' };
      } else {
        data = { roas: paidRevenue / totalSpend, attributedRevenue: paidRevenue, totalSpend };
      }
    }
  }
  const verificationStatus = evaluateBiVerification({
    computedAt, now: args.now, freshnessSlaMs, sourceValid, actualInputHash: inputHash,
  });
  return {
    dataSourceLabel: BI_DATA_SOURCE_LABEL,
    demoLabel: 'DEMO/SUPPLIED EVENTS — not live Shop, Meta, or payment data',
    companyId: principalCompanyId,
    tenantFilteredBeforeAggregation: true,
    metric,
    dimensions,
    provenance: buildBiProvenance({ metric, computedAt, freshnessSlaMs, inputHash, verificationStatus, sourceVersion: args.sourceVersion }),
    data,
  };
}

/** Current-claim entry point: builds the report, then blocks stale/unverifiable from current claims. */
export function queryBiCurrentClaim(args: Parameters<typeof queryBiReport>[0]): BiReport {
  const report = queryBiReport(args);
  assertVerifiedForCurrentClaim(report.provenance);
  return report;
}

export interface BiForensicsEntry {
  step: 'intent' | 'review' | 'approval' | 'execution' | 'outcome';
  occurredAt: string;
  evidence: {
    draftId: string;
    approvalJti: string | null;
    approvalHash: string | null;
    transactionRef: string | null;
    orderRef: string | null;
    outcomeRef: string | null;
  };
}

const FORENSICS_STEP: Record<BiFunnelStage, BiForensicsEntry['step']> = {
  intent: 'intent', review: 'review', approval: 'approval', transaction: 'execution', verified_outcome: 'outcome',
};

/** Forensics timeline keyed by draftId, each entry carrying its evidence refs. */
export function buildBiForensicsTimeline(args: {
  companyId: string;
  draftId: string;
  events: BiFunnelEvent[];
  transactionState?: string;
}): { draftId: string; companyId: string; transactionState: string | null; entries: BiForensicsEntry[] } {
  const draftEvents = args.events
    .filter((event) => event.companyId === args.companyId && event.draftId === args.draftId)
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  return {
    draftId: args.draftId,
    companyId: args.companyId,
    transactionState: args.transactionState ?? null,
    entries: draftEvents.map((event) => ({
      step: FORENSICS_STEP[event.stage],
      occurredAt: event.occurredAt,
      evidence: {
        draftId: event.draftId,
        approvalJti: event.approvalJti,
        approvalHash: event.approvalHash,
        transactionRef: event.transactionRef,
        orderRef: event.orderRef,
        outcomeRef: event.outcomeRef,
      },
    })),
  };
}

/** Hypotheses are labeled as hypotheses, with cited evidence — never causal conclusions. */
export function proposeBiHypothesis(args: { label: string; evidence: string[] }): {
  kind: 'hypothesis'; label: string; evidence: string[]; causalClaim: false;
} {
  if (!args.label?.trim()) throw new Error('bi_hypothesis_label_required');
  if (!Array.isArray(args.evidence) || args.evidence.length === 0) throw new Error('bi_hypothesis_evidence_required');
  return { kind: 'hypothesis', label: args.label.trim(), evidence: [...args.evidence], causalClaim: false };
}

export interface BiRemediationProposal {
  id: string;
  draftId: string;
  companyId: string;
  state: 'RECONCILE_REQUIRED';
  status: 'PROPOSED_REQUIRES_HUMAN_APPROVAL';
  summary: string;
  risk: string;
  rollback: string;
  owner: string;
  successCriteria: string[];
  autoRetryPayment: false;
  execution: 'human_approval_required';
}

/**
 * Human-approved remediation only. This returns a PROPOSAL; it never
 * executes anything and never auto-retries a payment. A separate,
 * human-approved reconciliation action (the existing provider
 * reconciliation route) is the only execution path.
 */
export function proposeReconcileRemediation(args: {
  draftId: string;
  companyId: string;
  summary: string;
  risk: string;
  rollback: string;
  owner: string;
  successCriteria: string[];
}): BiRemediationProposal {
  for (const [field, value] of Object.entries(args)) {
    if (typeof value === 'string' && !value.trim()) throw new Error(`bi_remediation_${field}_required`);
  }
  if (!Array.isArray(args.successCriteria) || args.successCriteria.length === 0 || args.successCriteria.some((c) => typeof c !== 'string' || !c.trim())) {
    throw new Error('bi_remediation_success_criteria_required');
  }
  return {
    id: `bi-remediation-${args.draftId}`,
    draftId: args.draftId.trim(),
    companyId: args.companyId.trim(),
    state: 'RECONCILE_REQUIRED',
    status: 'PROPOSED_REQUIRES_HUMAN_APPROVAL',
    summary: args.summary.trim(),
    risk: args.risk.trim(),
    rollback: args.rollback.trim(),
    owner: args.owner.trim(),
    successCriteria: args.successCriteria.map((c) => c.trim()),
    autoRetryPayment: false,
    execution: 'human_approval_required',
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Read-only dashboard rendering: demo label + provenance on every view. */
export function buildBiDashboardHtml(report: BiReport): string {
  const provenance = report.provenance;
  const statusLabel = biStatusLabel(provenance.verificationStatus);
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>Muse BI — DEMO/SUPPLIED EVENTS</title></head><body>',
    '<h1>Muse Business Intelligence</h1>',
    `<p><strong>${BI_DATA_SOURCE_LABEL}</strong> — not live Shop, Meta, or payment data. No campaign, budget, routing, ranking, or policy changes are made from BI.</p>`,
    `<p>Company (from authenticated principal): ${escapeHtml(report.companyId)} | Metric: ${escapeHtml(report.metric)} | Status: ${escapeHtml(statusLabel)}${statusLabel !== 'current' ? ' — do not present as a current claim' : ''}</p>`,
    '<h2>Provenance</h2><ul>',
    `<li>Definition: ${escapeHtml(provenance.definitionName)} v${escapeHtml(provenance.definitionVersion)}</li>`,
    `<li>Source: ${escapeHtml(provenance.source)} v${escapeHtml(provenance.sourceVersion)}</li>`,
    `<li>Computed at: ${escapeHtml(provenance.computedAt)} | Freshness SLA (ms): ${provenance.freshnessSlaMs}</li>`,
    `<li>Code version: ${escapeHtml(provenance.codeVersion)} | Input hash: ${escapeHtml(provenance.inputHash)}</li>`,
    `<li>Verification: ${escapeHtml(provenance.verificationStatus)}</li>`,
    '</ul><h2>Data</h2>',
    `<pre>${escapeHtml(JSON.stringify(report.data, null, 2))}</pre>`,
    '</body></html>',
  ].join('\n');
}

/** Read-only CSV export: provenance header first, then data rows. */
export function buildBiCsv(report: BiReport): string {
  const p = report.provenance;
  const header = [
    `# ${BI_DATA_SOURCE_LABEL} — not live Shop, Meta, or payment data`,
    `# company_id,${report.companyId}`,
    `# definition,${p.definitionName},version,${p.definitionVersion}`,
    `# source,${p.source},source_version,${p.sourceVersion}`,
    `# computed_at,${p.computedAt},freshness_sla_ms,${p.freshnessSlaMs},code_version,${p.codeVersion}`,
    `# input_hash,${p.inputHash},verification_status,${p.verificationStatus}`,
    `# metric,${report.metric}`,
  ].join('\n');
  const data = report.data as Record<string, unknown>;
  if (report.metric === 'funnel_counts' && Array.isArray(data)) {
    const rows = (data as Array<{ group: Record<string, string>; stages: Record<string, number> }>).map((row) =>
      [...Object.values(row.group), ...BI_FUNNEL_STAGES.map((stage) => String(row.stages[stage] ?? 0))].join(','));
    return `${header}\n${[...report.dimensions, ...BI_FUNNEL_STAGES].join(',')}\n${rows.join('\n')}\n`;
  }
  const rows = Object.entries(data).map(([key, value]) => `${key},${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  return `${header}\nkey,value\n${rows.join('\n')}\n`;
}
