# Live model reel-watch — Muse resolves a Reel (2026-10-29)

## What this is
A live run proving the "Muse watches the reel" step: `muse-spark-1.3` (Meta Model API)
received three frames from a real studio Reel and resolved the featured product against a
TEST catalog — with a strict instruction to return UNCERTAIN rather than guess.

This is the product's core safety property made visible: the model proposes, it never
grants. An ambiguous reel gets an honest "I see two products" instead of a wrong match.

## The run (2026-10-29 ~20:55 EDT)
- Model: `muse-spark-1.3` via `https://api.meta.ai/v1/chat/completions` (OpenAI-style,
  `image_url` data-URI blocks — image input verified working this run).
- Input: 3 frames (480px JPEG, 12–40KB each) at 2s / 7s / 12s from the 15-second THEENRG
  studio Reel used as the demo's hoodie reel (mixed-product cut), plus a resolver system
  prompt and a 2-item TEST catalog.
- TEST catalog (demo data from user screenshots, NOT a live catalog read):
  1. ENRG Unisex Oversized T-Shirt — $44.00 USD
  2. HVU Unisex Mineral Wash Boxy Full Zip Hoodie — $70.00 USD
- Budget: `max_tokens` 8192 (this model spends most of its budget on reasoning; 2048 was
  exhausted with zero content returned on the first attempt).
- Usage: 4011 total tokens (1873 prompt + 2138 completion, 2032 reasoning).

## Verbatim output
- VISIBLE: ENRG Unisex Oversized T-Shirt @ 2s, 12s; HVU Unisex Mineral Wash Boxy Full Zip Hoodie @ 7s
- FEATURED: UNCERTAIN
- CANDIDATES: ENRG Unisex Oversized T-Shirt, HVU Unisex Mineral Wash Boxy Full Zip Hoodie
- CONFIDENCE: medium
- NOTE: Both catalog items appear prominently with partial branding visible and no single clear focus.

## What this proves
- Multimodal input works through the connected Meta Model API.
- On a genuinely ambiguous reel, the resolver returned UNCERTAIN with both candidates
  instead of picking one — the designed behavior, and the correct one. A wrong guess
  here would have produced a wrong draft; the model refused to supply it.

## Honest limits
- One run, not a benchmark. No training or fine-tuning; nothing was written back anywhere.
- The model's timestamp read (tee @2s/12s, hoodie @7s) differs from the demo's caption
  notes (hoodie 0–10s, tee 10–15s). Timestamps are the model's read, not independently
  frame-verified.
- Catalog prices are TEST screenshot data. The model never invents prices; it used the
  supplied catalog or said unknown.
- Credential via Secure Vault only; no secret in chat, logs, or this repo.
- Probe cost: ~9,356 tokens total across all Meta Model API probes to date (Oct 26 + this run).

## Evidence strip (demo v39, 2026-10-29)

The hoodie review view now carries a "How Muse matched this Reel" card showing
the live model output: frame thumbnails at 0:07 (hoodie) and 0:02/0:12 (tee),
the per-item "seen at" list, and the verdict **UNCERTAIN** — presented as the
safety rule working, not as a failure. A live flow would ask "which one?"
instead of building a wrong draft.

## Embedding matching — status 2026-10-29

- The Meta Model API model list has no embedding endpoint (checked 2026-10-29:
  muse-spark/wonder/voice/image/sam only), so catalog-image embeddings run
  locally and test-only: CLIP ViT-B/32, precomputed, scores cached in the demo.
- Test: reel tee crop @0:12 vs theenrg.com tee product photo (expected high);
  reel hoodie crop @0:07 vs the same photo (expected low — correct rejection).
- A naive color-histogram baseline was tried first and REJECTED: it scored the
  hoodie crop higher than the tee crop (background-color confound). Only a
  semantic embedding is an acceptable visual-match signal here.
- CLIP weights were approved, downloaded, and run on 2026-10-30 — see the
  CLIP section at the end of this doc. Headline: CLIP does not separate the
  two reels either; the picker stays, now with measured evidence behind it.
  No invented scores are shown.

## Structured JSON output (2026-10-29, second probe)

The first probe returned labeled text (`VISIBLE:`/`FEATURED:` lines) that had
to be parsed. A second probe asked for strict JSON and returned it cleanly
(3,119 tokens, finish=stop, valid JSON): `visible` with per-item `seen_at`
timestamps and attributes, `featured: "UNCERTAIN"`, ranked `candidates`,
`confidence: "high"`, and a one-sentence note. The agent pipeline
(`muse-reel-grounding.ts`) consumes this JSON shape; the labeled-text format
is retired. Full output archived in `~/workspace/msi-reel-watch/frames/grounding_output.json`.

## CLIP embedding run — 2026-10-30 (local, test-only)

Method: OpenAI CLIP ViT-B/32, zero-shot, whole frames; 6 evenly spaced
frames per THEENRG studio reel; each frame embedded and compared (cosine)
against the tee catalog photo and against both product-name prompts.

How to read these scores: a CLIP score is a similarity, not a percentage
or a confidence — 0.377 does not mean "37.7% sure." Scores are only
meaningful as comparisons between candidates on the same input, where the
margin is the signal. Image-to-text scores live in a low range (a genuinely
matching description typically lands ~0.25–0.35; unrelated text sits near
0.1 or below), and photo-to-photo scores run higher than photo-to-text
scores — the two kinds are not comparable to each other.

Per-frame results (frame times 0.75 / 3.46 / 6.17 / 8.88 / 11.58 / 14.29 s):

Sanity — tee catalog photo vs prompts: tee prompt 0.3772, hoodie prompt
0.1256.

Reel A (tee reel), mean over 6 frames: vs tee photo 0.5419; vs tee prompt
0.2175; vs hoodie prompt 0.1733. Tee prompt wins 5/6 frames, mean margin
+0.0442.

Reel B (mixed/hoodie reel), mean over 6 frames: vs tee photo 0.5518; vs
tee prompt 0.2236; vs hoodie prompt 0.1727. Tee prompt wins 5/6 frames,
mean margin +0.0509.

Sanity check (product identity in isolation): the tee catalog photo scores
0.377 against the tee prompt vs 0.126 against the hoodie prompt — a decisive
+0.252 margin. CLIP knows the products apart when each is shown alone.

On the reels (mean over 6 frames): the tee reel scores 0.542 against the
tee photo, with a tee-prompt margin of +0.044 over the hoodie prompt; the
mixed/hoodie reel scores 0.552 against the tee photo — higher than the tee
reel itself — with a tee-prompt margin of +0.051. The tee prompt wins 5 of
6 frames on BOTH reels. An argmax rule would name the tee as the featured
product on both reels: right once, wrong once.

Conclusion: CLIP is an improvement in kind over the rejected color
histogram (which failed even the direct comparison), but zero-shot
whole-frame CLIP is not a usable featured-product signal for two similar
dark garments on the same model in the same studio. It corroborates
muse-spark-1.3's UNCERTAIN on the mixed reel rather than overturning it —
and it shows what the picker prevents: an honest "uncertain" becoming a
confident wrong answer. The demo's evidence card therefore does not
display CLIP scores; the "Which one?" picker remains the designed
behavior. Caveats: no hoodie catalog photo exists, so the image-side
comparison is one-directional; garment crops and temporal weighting were
not tested and are not claimed.

External benchmark context: "video-to-shop" is a benchmarked research
problem, and the published results point the same way. MovingFashion
(https://ar5iv.labs.arxiv.org/html/2110.02627) — 14,855 social-media
videos, each linked to its shop product image — is the standard public
benchmark for exactly this task; its best published model, SEAM
Match-RCNN (purpose-built, with attention-weighted multi-frame
aggregation), places the correct product in the top 5 of a 14K+ gallery
about 80% of the time, with top-1 accuracy far lower. On fine-grained
fashion retrieval (LookBench), strong current models score below 60%
Recall@1. Our two-reel probe is not a benchmark and is not presented as
one — but its direction matches the benchmarked reality: this matching
problem is hard even for specialized systems, which is why the consumer
flow asks instead of guessing. The checkpoint run is also the canonical
one — OpenAI's ViT-B/32, published zero-shot ImageNet top-1 of 63.2% —
so the reel result is not an artifact of a weak or misconfigured model.

## Live in the demo path (2026-10-31)

Numbering note: the briefs count the two THEENRG clips together as
"Reel 1", Travel as "Reel 2", and ClutchAgent as "Reel 3". This
document refers to the two THEENRG clips by feed position (first /
second) so the measurements stay unambiguous.

`POST /v1/demo/reel-grounding` on the production API puts Muse Spark
in the public demo's live path. Design constraints: the input is an
enum of demo reel ids only (no uploads, no free text — nothing a
visitor supplies reaches the model); the frames are fixed server-side
stills; the raw model output is validated by the same fail-closed
grounding module as the agent path (`muse-reel-grounding.ts`); results
are cached per reel for 24 hours and fresh model calls are budgeted
(20/hour), so the public endpoint cannot drain the model credit; CORS
is scoped to this path and the demo origin. The route cannot approve,
sign, or execute anything. The catalog context is the demo catalog
(the two THEENRG products, screenshot-derived, labelled `demo` in
every response) — not a live catalog read.

Each reel is judged on six frames sampled across its full 15 seconds
(1s, 2s, 5s, 7s, 10s, 12s). Measured live reads, 2026-10-31,
muse-spark-1.3:

- Studio clip V5 (first THEENRG clip in the feed, after the
  curation below): visible —
  the navy ENRG tee at 0:01, 0:02, 0:05, 0:12; the hoodie at 0:07.
  Featured: the tee, confidence **high** → grounding **exact**
  ($44.00 USD). A human frame-by-frame check confirmed the read: four
  of the six frames show the navy tee; one shows the hoodie; one shows
  a white "Highest Vibration" tee, which is not in the demo catalog
  and which the model did not claim.
- Studio clip V3 (second THEENRG clip in the feed): visible — tee
  at 0:01, 0:05; hoodie at
  0:07. Featured: **UNCERTAIN**, confidence medium → the picker.

Feed curation followed the measurements, not the other way round: the
exact-match reel now leads the demo feed and the picker reel follows,
and one reel's caption track was corrected — it described segments
the rendered video does not contain (the AI-generated clip follows
neither its generation prompt's segment layout nor the product label
it shipped with; the model's read was right and the caption was
wrong). The 3-frame sampling used in the 2026-10-29 probes was also
re-run through the live route before the switch to six frames: it
returned UNCERTAIN for both reels, which is what prompted the denser
sampling.

Fresh-call latency measured at 6–13 seconds; cached responses return
in about a second. Total Meta Model API spend across all 2026-10-29 →
2026-10-31 probing and live calls: roughly $0.08 of the $150 credit.

### Route v2 — catalog photos + seller-tag verification (2026-10-31)

Later the same day the route gained the two data points the first
version lacked. The model now also receives **both catalog photos**
(the tee photo, and the hoodie photo the user supplied from the live
theenrg.com product page that morning) as labelled reference images,
and each reel's **seller tag** (its product chip in the feed) as a
claim to verify: featured may equal the tagged title only when the
frames show it dominantly; otherwise UNCERTAIN with the note stating
what the frames actually favor. The response carries
`tag: {title, verified}`, where verified requires the server-side
grounding to land exact on the tagged product. A companion
`GET /v1/demo/status` (same CORS scope) reports API + model readiness
so the demo page's Live status card checks live instead of quoting a
dated snapshot.

Measured (fresh live calls, 2026-10-31 ~14:05–14:07Z, 13–17s each):

- First THEENRG clip (`theenrg-mixed`, tag = tee): EXACT tee,
  high confidence —
  "Navy ENRG tee dominates the runtime; hoodie only brief in the
  middle so featured is clear." **Tag verified: true.**
- Second THEENRG clip (`theenrg-tee`, tag = hoodie): **picker**
  on every run,
  **tag verified: false** (the server does not call a tag verified
  on a picker verdict). The model's raw answer varied between fresh
  calls — featured=hoodie at high confidence with both products
  as candidates in one run (hoodie in four of six frames per the
  photo match), featured=UNCERTAIN at medium confidence in another
  ("Tagged hoodie is clear at 0:07 but ENRG tee dominates at 0:01
  and 0:05 with non-catalog white tee at 0:10-0:12") — while the
  server-side verdict stayed stable: picker either way. The picker
  renders candidates in the model's own order for that run. That
  variance is itself the finding: raw model answers wobble on a
  genuinely mixed reel, so the deterministic server contract —
  never the model's confidence alone — decides what may proceed.

Demo v63 renders the picker from the live verdict (seen-at lines,
candidate order, both catalog photos) and shows the tag outcome on
the evidence card.
