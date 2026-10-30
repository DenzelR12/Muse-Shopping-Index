# Reel grounding — model proposes, server verifies

`apps/api/src/muse-reel-grounding.ts` (+ 8/8 tests in
`apps/api/test/muse-reel-grounding.test.ts`).

## Pipeline

1. **Model (muse-spark-1.3)** watches sampled Reel frames and returns strict
   JSON: `visible` (items + timestamps + attributes), `featured` (one catalog
   name or `UNCERTAIN`), `candidates` (ranked), `confidence`
   (high/medium/low). The model proposes; it never grants approval, never
   supplies prices, never signs a draft.
2. **Server (`groundReelCandidates`)** verifies the proposal against the
   company's own verified catalog (pure function, no network):
   - tenant check first (`companyId` must equal `principalCompanyId`);
   - malformed model output → fail closed;
   - `featured` names a verified item + confidence high → `exact`;
   - `featured` is `UNCERTAIN`, confidence medium/low, or featured names
     nothing verifiable → `picker` (consumer picks; the draft is built from
     the pick, never from a guess);
   - `featured` names something not in the catalog (hallucination/stale) →
     fail closed, never guess;
   - no candidate matches a verified item → fail closed;
   - candidates matching only unverifiable items are marked `item: null` —
     shown as unverifiable, never priced, never purchasable.
3. **Demo** renders the verdict: the "Which one?" picker on UNCERTAIN, the
   exact review on a confident verified match.

## Recorded fixture

Tests run offline against the transcribed 2026-10-29 live JSON output
(UNCERTAIN, both THEENRG items, confidence high). The live probe itself is
documented in `docs/meta-model-reel-watch.md`.
