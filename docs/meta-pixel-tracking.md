# Meta Pixel tracking — Muse Shopping Index

Status: demo wiring live in the interactive demo (v39); no events leave the device
until a real Pixel ID is configured. No production Conversions API yet.

## What is wired (demo, `docs/demo/index.html`)

- `META_PIXEL_ID = ""` (placeholder). The `fbevents.js` loader only runs when a
  real ID is set. Default: disabled.
- `pixelTrack(name, params)` — every call is journaled locally
  (`window._pixelJournal`, also `console.log('[pixel]', ...)`) whether or not a
  Pixel ID is set. When an ID is set, it also fires `fbq('track', name, params)`.
- Event map (demo funnel):
  - `ViewContent` — when a review opens (`toReview`, `toHoodieReview`, `toService`);
    carries `content_ids` and, for products, `value`/`currency`.
  - `InitiateCheckout` — on approval tap (`approve`, `approveHoodie`, `approveService`).
  - `Purchase` is **never** fired from the demo. It may only fire on a verified
    order from the server, never on a demo tap, a draft, or an approval alone.

## Production path (not built yet)

Browser pixel + Conversions API with the same `event_id` for dedup:
`ViewContent` on review open, `InitiateCheckout` on consumed approval,
`Purchase` only after the server verifies the provider receipt. The server —
never model text, never the demo — owns the Purchase event.

## Privacy rules

- No PII in event params (no names, emails, addresses, payment labels).
- Tenant-scoped: events carry the company/seller context only as an opaque ID
  the business owns; no cross-tenant joining.
- The demo's journal is local-only and inspectable; nothing is sent to Meta
  from the demo page until the site owner configures a real Pixel ID.
