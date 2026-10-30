# Muse production readiness

## Status

Muse Shopping Index is engineered so Muse is an intelligence/orchestration layer, not the authority for inventory, payment, booking, or fulfillment.

Meta Model API is OpenAI-SDK compatible and can be enabled without changing application code by setting:

- `META_MODEL_API_KEY`
- `META_MODEL_API_BASE_URL`
- `META_MUSE_MODEL`

The application also supports:

- bounded Muse request timeout
- bounded retry for transient 5xx/429/network failures
- deterministic fallback if Muse is unavailable
- non-secret readiness reporting
- deployment SHA reporting
- explicit approval before transaction commit

## External dependencies

These cannot be completed by repository code alone:

1. **Meta Model API credentials** from the project's Meta developer account.
2. **Exact Muse model ID** enabled for that account.
3. **Meta AI Connector / Muse Connector Platform access** for in-Muse distribution. Connector access is controlled by Meta and may be preview-gated.
4. **Merchant/provider credentials** for each real retailer, travel provider, ticketing system, service platform, or marketplace.
5. **Payment provider credentials** and webhook endpoint registration for live money movement.

## Runtime endpoints

- `GET /health` — process liveness plus build SHA
- `GET /ready` — non-secret Muse configuration state and competition capabilities

The readiness response deliberately never exposes API keys or secret values.

## Failure behavior

If Muse succeeds:
- Mode is `MUSE`.
- Parsed intent enters the Shopping Intelligence Index.

If Muse is unavailable, times out, emits invalid JSON, or returns retryable errors:
- The shopping request does not fail.
- The deterministic intent parser takes over.
- The response identifies fallback mode and reason.
- No transaction authority changes.

## Definition of fully competition-ready

- [x] CI green
- [x] Shopping Intelligence Index
- [x] outcome and company reliability learning
- [x] retail + travel demo
- [x] public deployment
- [x] deterministic fallback
- [x] explicit transaction approval
- [x] Stripe server-side checkout/webhook adapter
- [x] health/readiness/version endpoints
- [x] Muse timeout/retry/fallback behavior
- [ ] Meta Model API credentials configured in deployment
- [ ] one successful live Muse request verified
- [ ] Meta connector developer access granted if submission requires native in-Muse connector distribution

The last three items require external Meta account access rather than additional repository implementation.
