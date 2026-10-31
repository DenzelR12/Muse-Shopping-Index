/**
 * Public demo grounding — Muse Spark watches the demo reels, live.
 *
 * Purpose: the public demo (GitHub Pages) lets a visitor tap "Shop this
 * reel" and see the REAL model verdict that drives the flow, instead of
 * a recording. This module is the server half of that. It is deliberately
 * narrow and powerless:
 *
 * - Input is an enum of demo reel ids ONLY. No uploads, no free text, no
 *   URLs — nothing a visitor supplies ever reaches the model. The frames
 *   are fixed server-side stills (demo-reel-frames.ts).
 * - The catalog context is the DEMO catalog (two THEENRG products whose
 *   names/prices come from theenrg.com screenshots, labelled demo data
 *   in the prompt itself and in every response as catalogSource:"demo").
 *   It is NOT a live catalog read and never claims to be.
 * - The model's raw output is validated by the same fail-closed
 *   grounding module as the agent path (muse-reel-grounding.ts):
 *   exact only on a confident verified match, picker otherwise,
 *   fail-closed on anything malformed or unverifiable.
 * - This module cannot approve, sign, execute, or charge anything. It
 *   returns a verdict for display; the demo's purchase flow remains the
 *   labelled simulation it has always been.
 * - Cost/abuse bound: results are cached per reel for 24h and fresh
 *   model calls are globally budgeted (default max 20/hour), so a public
 *   endpoint cannot drain the model credit.
 */
import {
  groundReelCandidates,
  type GroundingCatalogItem,
  type ReelGroundingModelOutput,
  type ReelGroundingVerdict,
} from './muse-reel-grounding.js';
import { DEMO_REEL_FRAMES_B64 } from './demo-reel-frames.js';
import { DEMO_CATALOG_PHOTOS_B64 } from './demo-catalog-photos.js';

export const DEMO_GROUNDING_COMPANY_ID = 'theenrg-demo';

export const DEMO_GROUNDING_CATALOG: GroundingCatalogItem[] = [
  { title: 'ENRG Unisex Oversized T-Shirt', priceAmount: 44, currency: 'USD', status: 'verified' },
  { title: 'HVU Unisex Mineral Wash Boxy Full Zip Hoodie', priceAmount: 70, currency: 'USD', status: 'verified' },
];

export const DEMO_REEL_IDS = ['theenrg-tee', 'theenrg-mixed'] as const;
export type DemoReelId = (typeof DEMO_REEL_IDS)[number];

/**
 * Each demo reel's seller tag (its product chip in the demo feed) — a
 * claim the model is asked to VERIFY against the frames, never a fact
 * it may simply repeat. Reel order in the feed was curated on
 * 2026-10-31 from the measured reads: the V5 clip (id theenrg-mixed)
 * leads, tagged with the tee; the V3 clip (id theenrg-tee) follows,
 * tagged with the hoodie.
 */
export const DEMO_REEL_TAGS: Record<DemoReelId, string> = {
  'theenrg-mixed': 'ENRG Unisex Oversized T-Shirt',
  'theenrg-tee': 'HVU Unisex Mineral Wash Boxy Full Zip Hoodie',
};

export function isDemoReelId(value: unknown): value is DemoReelId {
  return typeof value === 'string' && (DEMO_REEL_IDS as readonly string[]).includes(value);
}

export interface DemoGroundingResult {
  reelId: DemoReelId;
  modelName: string;
  /** ISO time of the actual model call that produced this result. */
  modelRunAt: string;
  servedFrom: 'live' | 'cache';
  /** Always 'demo': screenshot-derived THEENRG products, not a live catalog read. */
  catalogSource: 'demo';
  /** The seller tag for this reel and whether the frames verified it. */
  tag: { title: string; verified: boolean };
  modelOutput: ReelGroundingModelOutput | null;
  grounding: ReelGroundingVerdict;
}

export interface DemoGroundingDeps {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
  maxFreshCallsPerHour?: number;
}

const SYSTEM_PROMPT =
  'You are the visual grounding step for a shopping assistant. You receive frames from a short product Reel and a small catalog. ' +
  'Your job is ONLY to report what is visibly in the frames and which single catalog product the Reel features. ' +
  '(1) List each distinct apparel product visibly worn or shown, with the timestamp(s) it appears at. ' +
  '(2) Match ONLY against the catalog given below. A match needs the visible item to clearly correspond to a catalog entry by garment type and any visible branding. Use catalog titles EXACTLY as written. ' +
  '(3) Decide the reel\'s FEATURED product: the one the reel is about. If two catalog items appear prominently and you cannot tell which the reel features, return featured: "UNCERTAIN" and list both candidates. ' +
  '(4) Never invent prices, sizes, colors, or availability. ' +
  '(5) Never guess. Uncertainty is a valid, preferred output over a wrong match. ' +
  'Answer with strict JSON only — no prose, no code fences.';

function buildUserText(tagTitle: string): string {
  return (
    'Six frames from a 15-second studio Reel, sampled across its full length (timestamps 1s, 2s, 5s, 7s, 10s, 12s), preceded by the two catalog reference photos (photo 1 = ENRG Unisex Oversized T-Shirt, photo 2 = HVU Unisex Mineral Wash Boxy Full Zip Hoodie). Match the frames against the reference photos as well as the product names. On-screen text includes "VIBER UNIVERSITY"-style branding.\n\n' +
    'TEST CATALOG (demo data from screenshots, not a live catalog read):\n' +
    '1. ENRG Unisex Oversized T-Shirt — $44.00 USD\n' +
    '2. HVU Unisex Mineral Wash Boxy Full Zip Hoodie — $70.00 USD\n\n' +
    `SELLER TAG: this reel was tagged by the seller as: ${tagTitle}.\n` +
    'Treat the tag as a claim to verify against the frames, never as truth by itself. Return featured = the tagged title ONLY if the frames clearly show that product as the dominant product of the reel. If the tagged product appears but another catalog product dominates the frames, or no product dominates, return featured: "UNCERTAIN", list the verifiable candidates, and use the note to say plainly what the frames actually favor.\n\n' +
    'Respond with strict JSON only, in this shape:\n' +
    '{"visible":[{"label":"<exact catalog title>","seen_at":["0:02"],"attributes":{"garment":"t-shirt"}}], ' +
    '"featured":"<exact catalog title>" | "UNCERTAIN", "candidates":["<exact catalog title>"], ' +
    '"confidence":"high" | "medium" | "low", "note":"<one line on what made it certain or uncertain>"}'
  );
}

interface CacheEntry {
  at: number;
  result: DemoGroundingResult;
}

const cache = new Map<DemoReelId, CacheEntry>();
const inFlight = new Map<DemoReelId, Promise<DemoGroundingResult>>();
let freshCallTimestamps: number[] = [];

export function resetDemoGroundingState(): void {
  cache.clear();
  inFlight.clear();
  freshCallTimestamps = [];
}

function parseModelContent(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function callModel(reelId: DemoReelId, deps: Required<Omit<DemoGroundingDeps, 'apiKey' | 'baseUrl' | 'model'>> & DemoGroundingDeps): Promise<DemoGroundingResult> {
  const frames = DEMO_REEL_FRAMES_B64[reelId];
  if (!frames || frames.length === 0) throw new Error('demo_grounding_frames_missing');
  const tagTitle = DEMO_REEL_TAGS[reelId];
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: buildUserText(tagTitle) }];
  for (const item of DEMO_GROUNDING_CATALOG) {
    const photo = DEMO_CATALOG_PHOTOS_B64[item.title];
    if (photo) {
      content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${photo}` } });
    }
  }
  for (const frame of frames) {
    content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame}` } });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  let response: Response;
  try {
    response = await deps.fetchImpl(`${deps.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${deps.apiKey}` },
      body: JSON.stringify({
        model: deps.model,
        max_tokens: 8192,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`demo_grounding_model_http_${response.status}`);
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawContent = body.choices?.[0]?.message?.content;
  const parsed = typeof rawContent === 'string' ? parseModelContent(rawContent) : null;
  const grounding = groundReelCandidates({
    modelOutput: parsed,
    catalog: DEMO_GROUNDING_CATALOG,
    companyId: DEMO_GROUNDING_COMPANY_ID,
    principalCompanyId: DEMO_GROUNDING_COMPANY_ID,
  });
  const modelOutput =
    parsed && typeof parsed === 'object' ? (parsed as ReelGroundingModelOutput) : null;
  return {
    reelId,
    modelName: deps.model,
    modelRunAt: new Date(deps.now()).toISOString(),
    servedFrom: 'live',
    catalogSource: 'demo',
    tag: {
      title: tagTitle,
      verified: grounding.verdict === 'exact' && grounding.item.title === tagTitle,
    },
    modelOutput: grounding.verdict === 'fail-closed' ? null : modelOutput,
    grounding,
  };
}

/**
 * Returns the grounding verdict for a demo reel: from the 24h cache when
 * fresh, otherwise from a live Muse Spark call. Throws
 * 'demo_grounding_budget_exhausted' when the fresh-call budget is spent
 * and no cache entry exists, and 'demo_grounding_frames_missing' for an
 * unconfigured reel. Transport/model HTTP failures propagate as errors.
 */
export async function getDemoReelGrounding(
  reelId: DemoReelId,
  deps: DemoGroundingDeps,
): Promise<DemoGroundingResult> {
  const full: Required<Omit<DemoGroundingDeps, 'apiKey' | 'baseUrl' | 'model'>> & DemoGroundingDeps = {
    fetchImpl: deps.fetchImpl ?? fetch,
    now: deps.now ?? (() => Date.now()),
    cacheTtlMs: deps.cacheTtlMs ?? 24 * 60 * 60 * 1000,
    maxFreshCallsPerHour: deps.maxFreshCallsPerHour ?? 20,
    ...deps,
  };
  const nowMs = full.now();
  const hit = cache.get(reelId);
  if (hit && nowMs - hit.at < full.cacheTtlMs) {
    return { ...hit.result, servedFrom: 'cache' };
  }
  const pending = inFlight.get(reelId);
  if (pending) return pending;
  freshCallTimestamps = freshCallTimestamps.filter((t) => nowMs - t < 60 * 60 * 1000);
  if (freshCallTimestamps.length >= full.maxFreshCallsPerHour) {
    if (hit) return { ...hit.result, servedFrom: 'cache' };
    throw new Error('demo_grounding_budget_exhausted');
  }
  freshCallTimestamps.push(nowMs);
  const promise = callModel(reelId, full)
    .then((result) => {
      cache.set(reelId, { at: full.now(), result });
      return result;
    })
    .finally(() => {
      inFlight.delete(reelId);
    });
  inFlight.set(reelId, promise);
  return promise;
}
