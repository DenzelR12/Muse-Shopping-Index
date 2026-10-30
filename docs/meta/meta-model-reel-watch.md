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
- CLIP weights download (~350MB, one-time) was pending user approval at
  writing time; the demo card shows "pending embedding run" until real scores
  land. No invented scores are shown.

## Structured JSON output (2026-10-29, second probe)

The first probe returned labeled text (`VISIBLE:`/`FEATURED:` lines) that had
to be parsed. A second probe asked for strict JSON and returned it cleanly
(3,119 tokens, finish=stop, valid JSON): `visible` with per-item `seen_at`
timestamps and attributes, `featured: "UNCERTAIN"`, ranked `candidates`,
`confidence: "high"`, and a one-sentence note. The agent pipeline
(`muse-reel-grounding.ts`) consumes this JSON shape; the labeled-text format
is retired. Full output archived in `~/workspace/msi-reel-watch/frames/grounding_output.json`.
