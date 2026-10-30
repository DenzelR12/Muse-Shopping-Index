/**
 * Reel grounding verdict — Muse Shopping Index.
 *
 * The model (muse-spark-1.3) watches Reel frames and PROPOSES candidates as
 * structured JSON: visible items, a featured item or UNCERTAIN, ranked
 * candidates, and a confidence level. This module VERIFIES those proposals
 * against the company's own verified catalog. The model never grants
 * approval, never supplies prices, and never picks the item alone.
 *
 * This replaces the hardcoded `skuMatchVerified: false` in the reel
 * interpretation harness with a real verification path:
 *
 * - featured names a verified catalog item + confidence high -> exact
 * - featured is UNCERTAIN, or names nothing verifiable, or confidence is
 *   medium/low -> picker (the consumer picks; the draft is built from the
 *   pick, never from a guess)
 * - no candidate matches a verified catalog item -> fail closed
 *
 * Pure function: no network, no model call, no secrets. Tenant-scoped:
 * companyId must equal principalCompanyId or it throws before doing
 * anything. Prices come only from verified catalog items, never from
 * model text.
 */

export interface ReelGroundingVisibleItem {
  label: string;
  seen_at: string[];
  attributes?: Record<string, string>;
}

export interface ReelGroundingModelOutput {
  visible: ReelGroundingVisibleItem[];
  featured: string;
  candidates: string[];
  confidence: 'high' | 'medium' | 'low';
  note?: string;
}

export interface GroundingCatalogItem {
  title: string;
  priceAmount: number;
  currency: string;
  status: 'verified' | 'unavailable' | 'unverifiable';
}

export type ReelGroundingVerdict =
  | { verdict: 'exact'; item: GroundingCatalogItem; modelLabel: string }
  | {
      verdict: 'picker';
      candidates: Array<{ modelLabel: string; item: GroundingCatalogItem | null }>;
    }
  | { verdict: 'fail-closed'; reason: string };

export const MUSE_GROUNDING_UNCERTAIN = 'UNCERTAIN';

function normTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isValidOutput(o: unknown): o is ReelGroundingModelOutput {
  if (!o || typeof o !== 'object') return false;
  const r = o as Record<string, unknown>;
  return (
    Array.isArray(r.visible) &&
    typeof r.featured === 'string' &&
    Array.isArray(r.candidates) &&
    (r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low')
  );
}

export function groundReelCandidates(args: {
  modelOutput: unknown;
  catalog: GroundingCatalogItem[];
  companyId: string;
  principalCompanyId: string;
}): ReelGroundingVerdict {
  const { modelOutput, catalog, companyId, principalCompanyId } = args;

  if (companyId !== principalCompanyId) {
    throw new Error('muse_grounding_company_mismatch');
  }
  if (!isValidOutput(modelOutput)) {
    return { verdict: 'fail-closed', reason: 'muse_grounding_malformed_output' };
  }

  const verifiedByTitle = new Map<string, GroundingCatalogItem>();
  for (const item of catalog) {
    if (item.status === 'verified' && item.title && item.priceAmount > 0 && item.currency) {
      verifiedByTitle.set(normTitle(item.title), item);
    }
  }

  const matchCandidate = (label: string): GroundingCatalogItem | null =>
    verifiedByTitle.get(normTitle(label)) ?? null;

  // Exact path: the model names one verified catalog item, confidently.
  if (modelOutput.featured !== MUSE_GROUNDING_UNCERTAIN && modelOutput.confidence === 'high') {
    const item = matchCandidate(modelOutput.featured);
    if (item) {
      return { verdict: 'exact', item, modelLabel: modelOutput.featured };
    }
    // The model named something that is not a verified catalog item:
    // a hallucination or a stale catalog. Fail closed, never guess.
    return { verdict: 'fail-closed', reason: 'muse_grounding_featured_not_in_catalog' };
  }

  // Picker path: UNCERTAIN, medium/low confidence, or featured unresolvable.
  // Every candidate is resolved against the verified catalog; candidates
  // with no verified match are marked null (shown as unverifiable, never
  // priced, never purchasable).
  const candidates = modelOutput.candidates.map((label) => ({
    modelLabel: label,
    item: matchCandidate(label),
  }));
  const anyVerified = candidates.some((c) => c.item !== null);
  if (!anyVerified) {
    return { verdict: 'fail-closed', reason: 'muse_grounding_no_verified_candidate' };
  }
  return { verdict: 'picker', candidates };
}
