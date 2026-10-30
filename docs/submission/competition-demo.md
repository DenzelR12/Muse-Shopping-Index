# Competition demo

Run the complete Shopping Intelligence Index demo with:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm demo
```

Open `http://localhost:3100`.

The demo works without external credentials using deterministic intent extraction. To make Muse interpret the request live, set `META_MODEL_API_KEY`, `META_MODEL_API_BASE_URL`, and `META_MUSE_MODEL` from the Meta Model API account. Meta documents the Model API as OpenAI-compatible, so the demo uses the standard `/chat/completions` shape while keeping the endpoint and model ID configurable.

## 90-second judge flow

1. Enter: **“I need a premium carry-on under $350 for a business trip.”**
2. Show that Muse Shopping Index searches multiple connected companies through one index.
3. Select the highest-ranked option.
4. Show the exact reviewable transaction draft and security language.
5. Approve the demo action.
6. Show the provider reference and fulfillment state.
7. If showing interaction counts, label the current baseline figures as illustrative until a real comparison has been recorded.
8. Switch to the travel example: **“Plan a theme park trip for four in Orlando under $4,000 with two park days.”**
9. Explain that the same index and connector contract handles products and bookings.

No real payment or booking is performed in demo mode. Production integrations replace the demo offer adapters and transaction rail while preserving the same approval and revalidation boundaries.

