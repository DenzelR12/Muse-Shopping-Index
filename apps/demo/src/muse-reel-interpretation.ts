/**
 * Muse Reel interpretation — deterministic TEST harness, not a live call.
 *
 * Muse Shopping Index is a Muse feature, not a storefront. A Reel press
 * must end in a server-validated exact review in a Muse window — never
 * in a model sentence, a caption, or an image description presented as
 * a fact. This module is the harness that shows that rule working on
 * the real ENRG Reel the user supplied, using only the existing pure
 * candidate + verification logic (muse-multimodal-intent.ts).
 *
 * WHAT THIS IS:
 * - interpretMuseReel() takes an UNTRUSTED Reel observation (a
 *   description of what the Reel shows, a caption, an audio hint) and
 *   a caller-supplied catalog record, and returns one of three
 *   outcomes. It is pure: no network call, no Meta API call, no model
 *   call, no credential, no probe.
 * - eligible_for_exact_review: the Reel's terms match the catalog
 *   title AND the catalog record is fresh and available AND no
 *   caption price contradicts it. Facts come from the catalog record
 *   only. The result still requires a consumer approval and executes
 *   nothing: approvalRequired is true, executed is false, always.
 * - drift_reapproval_required: a caption price contradicts the
 *   catalog price (for example caption $199 vs catalog $249). The
 *   catalog price wins; no draft is signed and no approval is
 *   consumed, so the claimed price can never become a price.
 * - unverifiable: no catalog record, or a stale / unavailable /
 *   title-mismatched record, or no intent terms at all. No exact
 *   review may be built from this outcome.
 * - interpretEnrgReel() is the same function with the real ENRG Reel
 *   observation pre-filled, so a demo can run the (a) match case
 *   without retyping the observation.
 *
 * LABELLING LIMITS — READ BEFORE SHOWING ANY RESULT:
 * - The ENRG observation is SCREENSHOT / UPLOAD EVIDENCE ONLY: an
 *   Instagram reel (Deo7I3cR7Wq), a 5.775s screen recording showing
 *   a person wearing dark ENRG apparel, and theenrg.com screenshots
 *   listing the ENRG Unisex Oversized T-Shirt at $44.00 USD.
 * - The Reel-to-exact-SKU match is NOT independently verified. An
 *   eligible result therefore carries skuMatchVerified: false, and
 *   must be described as "Reel terms match the catalog title", never
 *   as "this Reel is proven to be this exact SKU". A live SKU proof
 *   would need a verified catalog link for that Reel, which does not
 *   exist in this harness.
 * - The $44.00 USD price is a screenshot price, not a live Shopify
 *   Storefront read and not a live Meta catalog read. The harness
 *   takes it as a caller-supplied catalog record in the test, and
 *   labels it TEST wherever it is shown.
 * - This harness does NOT claim a live Meta Model API call, live
 *   Reel ingestion, native Meta distribution, or a signed Reel
 *   callback. The INTENDED production path, documented only, is:
 *   Meta Model API interprets the Reel -> candidate terms ->
 *   read-only, tenant-scoped catalog read (Meta catalog or Shopify
 *   Storefront) -> this same verification -> server-owned signed
 *   draft -> exact review -> one consumer approval -> server
 *   execution. That path needs its own authorizations and is not
 *   run, probed, or credentialled here.
 * - Raw IDs are stripped by the candidate builder before any term is
 *   extracted, and no result type carries an ID field.
 */

import {
  buildMultimodalIntentCandidate,
  verifyMultimodalIntentAgainstCatalog,
  type MuseCatalogRecordForIntent,
} from './muse-multimodal-intent.js';

export interface MuseReelObservation {
  /** Public Reel identifier supplied by the user. Not a seller secret. */
  reelId: string;
  /** Untrusted description of what the Reel shows. Never a product fact. */
  imageDescription?: string;
  /** Untrusted caption text. Never a product fact. */
  caption?: string;
  /** Untrusted audio-transcript hint. Never a product fact. */
  audioTranscriptHint?: string;
}

/**
 * The real ENRG Reel, as supplied by the user. Screenshot / upload
 * evidence only — see the labelling limits above. No caption was
 * supplied with this Reel, so none is invented here.
 */
export const ENRG_REEL_OBSERVATION: MuseReelObservation = {
  reelId: 'Deo7I3cR7Wq',
  imageDescription: 'person wearing dark ENRG apparel',
};

/** Caller-supplied catalog record for the ENRG tee (TEST, screenshot price). */
export const ENRG_TEE_CATALOG_TEST: MuseCatalogRecordForIntent = {
  title: 'ENRG Unisex Oversized T-Shirt',
  priceAmount: 44,
  currency: 'USD',
  available: true,
  updatedAt: '2026-10-27T10:00:00.000Z',
};

export type MuseReelInterpretation =
  | {
      status: 'eligible_for_exact_review';
      reelId: string;
      /** Facts from the catalog record only. Never from the observation. */
      title: string;
      priceAmount: number;
      currency: string;
      matchedTerms: string[];
      approvalRequired: true;
      executed: false;
      /** Always false in this harness: SKU match is NOT independently verified. */
      skuMatchVerified: false;
    }
  | {
      status: 'drift_reapproval_required';
      reelId: string;
      reason: 'caption_price_mismatch';
      catalogPriceAmount: number;
      currency: string;
      claimedPriceAmount: number;
      draftSigned: false;
      approvalConsumed: false;
    }
  | {
      status: 'unverifiable';
      reelId: string;
      reason:
        | 'no_catalog_match'
        | 'catalog_stale'
        | 'catalog_unavailable'
        | 'title_terms_no_match'
        | 'no_intent_terms';
      draftSigned: false;
      approvalConsumed: false;
    };

export function interpretMuseReel(args: {
  observation: MuseReelObservation;
  catalog: MuseCatalogRecordForIntent | null;
  now: string;
}): MuseReelInterpretation {
  const candidate = buildMultimodalIntentCandidate({
    imageDescription: args.observation.imageDescription,
    caption: args.observation.caption,
    audioTranscriptHint: args.observation.audioTranscriptHint,
  });
  const result = verifyMultimodalIntentAgainstCatalog(candidate, args.catalog, args.now);
  if (result.status === 'eligible_for_exact_review') {
    return {
      status: 'eligible_for_exact_review',
      reelId: args.observation.reelId,
      title: result.title,
      priceAmount: result.priceAmount,
      currency: result.currency,
      matchedTerms: result.matchedTerms,
      approvalRequired: true,
      executed: false,
      skuMatchVerified: false,
    };
  }
  if (result.status === 'drift_reapproval_required') {
    return {
      status: 'drift_reapproval_required',
      reelId: args.observation.reelId,
      reason: result.reason,
      catalogPriceAmount: result.catalogPriceAmount,
      currency: result.currency,
      claimedPriceAmount: result.claimedPriceAmount,
      draftSigned: false,
      approvalConsumed: false,
    };
  }
  return {
    status: 'unverifiable',
    reelId: args.observation.reelId,
    reason: result.reason,
    draftSigned: false,
    approvalConsumed: false,
  };
}

export function interpretEnrgReel(args: {
  catalog: MuseCatalogRecordForIntent | null;
  now: string;
}): MuseReelInterpretation {
  return interpretMuseReel({
    observation: ENRG_REEL_OBSERVATION,
    catalog: args.catalog,
    now: args.now,
  });
}
