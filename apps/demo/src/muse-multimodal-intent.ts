/**
 * Multimodal Reel intent — candidate only, never a fact.
 *
 * Muse Shopping Index is a Muse feature, not a storefront. The review a
 * consumer sees in a Muse window is a server-validated exact review, never
 * a model sentence, a caption, or an image description.
 *
 * WHAT THIS MODULE DOES:
 * - Takes UNTRUSTED inputs — a description of a Reel image, a caption, and
 *   an optional audio-transcript hint — and builds an intent CANDIDATE:
 *   a set of search terms plus, if the caption asserts a price, that
 *   asserted price recorded as an untrusted claim, never as a fact.
 * - Compares that candidate against a catalog record supplied by the
 *   caller (in production: a read-only, tenant-scoped catalog read —
 *   Meta catalog or Shopify Storefront — whose raw IDs the caller has
 *   already stripped). The catalog record is the only source of facts.
 *
 * WHAT THIS MODULE NEVER DOES:
 * - It never supplies a seller title, price, currency, or stock level.
 *   An eligible result carries the catalog record's title, price, and
 *   currency, and nothing from the candidate.
 * - It never overrides the catalog. Caption $199 vs catalog $249 is a
 *   drift / reapproval case, not a $199 price: the model does not win.
 * - It never presents anything as exact terms when there is no catalog
 *   match, when the catalog record is stale or unavailable, or when the
 *   candidate's terms do not match the catalog title at all. Those cases
 *   are `unverifiable`, and a Muse window must not show them as a review.
 * - It never returns a raw ID. `stripRawIdsFromText` removes gid://
 *   identifiers, *.myshopify.com domains, and acct_ identifiers from
 *   candidate text before any term is extracted, and the result types
 *   carry no ID field at all.
 * - It makes no network call, no Meta API call, and no model call. It is
 *   pure candidate construction + pure verification, so it can be tested
 *   with mocked catalog records and cannot invent a live read.
 *
 * AMOUNTS: a price parsed from a caption is a claim to be checked, never
 * a canonical amount. Canonical amounts come from the catalog record
 * (numeric amount + ISO currency) and are compared in whole cents.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with',
  'this', 'that', 'it', 'is', 'are', 'buy', 'shop', 'check', 'out',
  'get', 'your', 'you', 'i', 'we', 'my', 'from', 'now', 'just', 'new',
]);

const RAW_ID_PATTERNS: RegExp[] = [
  /gid:\/\/[^\s,;]+/gi,
  /[a-z0-9-]+\.myshopify\.com/gi,
  /acct_[a-zA-Z0-9]+/g,
];

export function stripRawIdsFromText(text: string): string {
  let out = text ?? '';
  for (const pattern of RAW_ID_PATTERNS) out = out.replace(pattern, ' ');
  return out;
}

export interface MuseMultimodalIntentInput {
  /** Untrusted description of the Reel image. Never a product fact. */
  imageDescription?: string;
  /** Untrusted caption text. Never a product fact. */
  caption?: string;
  /** Untrusted audio-transcript hint. Never a product fact. */
  audioTranscriptHint?: string;
}

export interface MuseMultimodalIntentCandidate {
  /** Lowercased, de-duplicated, stopword-filtered terms from all inputs. */
  terms: string[];
  hasImage: boolean;
  hasCaption: boolean;
  hasAudioHint: boolean;
  /**
   * A price the caption ASSERTS, if one is present, recorded only so it
   * can be checked against the catalog. This is an untrusted claim, never
   * a price, and it is never carried into an exact review.
   */
  claimedPriceAmount?: number;
  claimedCurrency?: string;
}

export interface MuseCatalogRecordForIntent {
  /** Catalog-verified title. The only title an eligible result may use. */
  title: string;
  /** Catalog-verified price amount. The only price an eligible result may use. */
  priceAmount: number;
  /** Catalog-verified ISO currency code. */
  currency: string;
  /** Catalog availability at read time. */
  available: boolean;
  /** ISO timestamp of the catalog record. Older than 24h is stale. */
  updatedAt: string;
}

export type MuseMultimodalVerification =
  | {
      status: 'eligible_for_exact_review';
      /** Facts from the catalog record only. Never from the candidate. */
      title: string;
      priceAmount: number;
      currency: string;
      matchedTerms: string[];
    }
  | {
      status: 'drift_reapproval_required';
      reason: 'caption_price_mismatch';
      /** The catalog price, which wins. The claimed price does not. */
      catalogPriceAmount: number;
      currency: string;
      /** The untrusted claim, reported so the diff can be shown in words. */
      claimedPriceAmount: number;
    }
  | {
      status: 'unverifiable';
      reason:
        | 'no_catalog_match'
        | 'catalog_stale'
        | 'catalog_unavailable'
        | 'title_terms_no_match'
        | 'no_intent_terms';
    };

function tokenize(text: string): string[] {
  const clean = stripRawIdsFromText(text).toLowerCase();
  const tokens = clean.split(/[^a-z0-9]+/).filter(Boolean);
  const out: string[] = [];
  for (const token of tokens) {
    if (STOPWORDS.has(token)) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

function extractClaimedPrice(caption: string): { amount: number; currency: string } | undefined {
  // A dollar amount asserted in a caption, e.g. "$199" or "$249.00".
  // This is a claim to check, never a canonical amount: the catalog
  // record's numeric amount + ISO currency is the only canonical form.
  const match = /\$\s?(\d+(?:\.\d{1,2})?)/.exec(caption);
  if (!match) return undefined;
  return { amount: Number(match[1]), currency: 'USD' };
}

export function buildMultimodalIntentCandidate(
  input: MuseMultimodalIntentInput,
): MuseMultimodalIntentCandidate {
  const imageDescription = input.imageDescription ?? '';
  const caption = input.caption ?? '';
  const audioTranscriptHint = input.audioTranscriptHint ?? '';
  const terms = tokenize(`${imageDescription} ${caption} ${audioTranscriptHint}`);
  const claimed = caption ? extractClaimedPrice(caption) : undefined;
  return {
    terms,
    hasImage: imageDescription.trim().length > 0,
    hasCaption: caption.trim().length > 0,
    hasAudioHint: audioTranscriptHint.trim().length > 0,
    ...(claimed
      ? { claimedPriceAmount: claimed.amount, claimedCurrency: claimed.currency }
      : {}),
  };
}

const FRESHNESS_MS = 24 * 60 * 60 * 1000;

export function verifyMultimodalIntentAgainstCatalog(
  candidate: MuseMultimodalIntentCandidate,
  catalog: MuseCatalogRecordForIntent | null,
  now: string,
): MuseMultimodalVerification {
  if (candidate.terms.length === 0) {
    return { status: 'unverifiable', reason: 'no_intent_terms' };
  }
  if (!catalog) {
    return { status: 'unverifiable', reason: 'no_catalog_match' };
  }
  const updatedMs = Date.parse(catalog.updatedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(updatedMs) || Number.isNaN(nowMs) || updatedMs > nowMs || nowMs - updatedMs > FRESHNESS_MS) {
    return { status: 'unverifiable', reason: 'catalog_stale' };
  }
  if (!catalog.available) {
    return { status: 'unverifiable', reason: 'catalog_unavailable' };
  }
  if (
    candidate.claimedPriceAmount !== undefined &&
    Math.round(candidate.claimedPriceAmount * 100) !== Math.round(catalog.priceAmount * 100)
  ) {
    return {
      status: 'drift_reapproval_required',
      reason: 'caption_price_mismatch',
      catalogPriceAmount: catalog.priceAmount,
      currency: catalog.currency,
      claimedPriceAmount: candidate.claimedPriceAmount,
    };
  }
  const titleTerms = tokenize(catalog.title);
  const matchedTerms = candidate.terms.filter((term) => titleTerms.includes(term));
  if (matchedTerms.length === 0) {
    return { status: 'unverifiable', reason: 'title_terms_no_match' };
  }
  return {
    status: 'eligible_for_exact_review',
    title: catalog.title,
    priceAmount: catalog.priceAmount,
    currency: catalog.currency,
    matchedTerms,
  };
}
