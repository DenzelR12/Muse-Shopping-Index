# Meta lead callback webhook — design (code-ready, NOT live)

> Muse feature, not a storefront. This is a **separate callback-lead
> feature**, not the Shop-this-reel purchase flow. A callback request
> never grants approval, never signs a draft, and never executes a
> purchase. It only records that a consumer asked for a callback, so
> an authorized business can follow up.

## Status: code-ready, NOT mounted, NOT live

- Code: `apps/api/src/muse-lead-webhook.ts` (pure, injectable
  handler) + `apps/api/test/muse-lead-webhook.test.ts` (pure tests)
  + one gate in the CI-listed `apps/api/test/provider-readiness.test.ts`.
- **No route is mounted in `apps/api/src/index.ts`.** Wiring the
  handler into index.ts is a separate, separately verifiable step,
  and until it exists there is no live lead webhook endpoint, no live
  HTTP traffic, and no live Graph fetch.
- **No live Meta result is claimed:** no leadgen subscription, no
  `leads_retrieval` approval, no live lead, no live callback, and no
  live Graph fetch are verified. The Meta app (`muse shop index`,
  child app inside Muse Shopping Index) is Unpublished and its
  Catalog API calls were 0 at last check.
- **No Postgres is wired.** The only store in code is the memory
  store (`createLeadCallbackMemoryStore`, keyed by leadgen_id +
  companyId). The future table name is documented in the module
  header (`muse_lead_callbacks`, UNIQUE on
  `(leadgen_id, company_id)`); that migration is not done and must
  not be claimed.

## Webhook-first, polling only as fallback / backfill

**Webhook-first (recommended, and the only primary path in this design):**

1. In the Meta app dashboard, subscribe to the `leadgen` field
   under the Page object. Meta then POSTs a notification to the
   server's HTTPS endpoint whenever a callback request is submitted
   via a Reel or Call Ad.
2. The notification carries a `leadgen_id` (plus page/form/ad
   identifiers for routing). The server verifies the signature,
   maps the page to a company, and only then fetches the full lead
   once via Graph (`GET /v26.0/{lead_id}` — version constant only
   in code; the fetch itself is an injected interface, not a live
   call in this module).
3. The fetched `field_data` supplies exactly three values:
   `full_name`, `phone_number`, `preferred_callback_date_time`.

**Polling only as fallback / backfill:** a scheduled pull of
`GET /{ad_id}/leads` and `GET /{lead_id}` may backfill a missed
delivery, but it is not the primary path — polling delays the
callback follow-up that is the whole point of the feature, and it
must use the same tenant mapping, signature-free (token-gated)
server credential, field validation, and deduplication as the
webhook path. Polling must never bypass the webhook handler's
fail-closed checks.

## Subscription and permissions (App Review required)

- Subscription: `leadgen` field under the Page object in the Meta
  app dashboard, to a server HTTPS endpoint.
- Required permissions, as in the brief, flagged as needing App
  Review: `leads_retrieval`, plus `pages_read_engagement` and
  `pages_manage_ads`. None of these is verified as approved for
  `muse shop index` today.
- Business Verification / per-seller OAuth story for other
  businesses: exactly the platform story used for catalogs. An own
  test catalog / own Page in Development Mode does not authorize
  other businesses' leads. For any other business, that business
  must authorize its own Page and leads through OAuth, and its
  leads must be mapped to its own companyId only. **Never use one
  Page token or one System User token across companies.**
- HTTPS endpoint requirement: Meta webhooks require a public HTTPS
  endpoint. A local or non-HTTPS endpoint cannot receive them.
  That endpoint, its verify token, and its app secret are
  server-owned configuration in a secret manager — never in code,
  tests, docs, screenshots, chat, or the repo.

## Signature verification (fail closed)

- Subscription handshake (`verifyWebhookSubscription`): the
  `hub.challenge` is returned only when `hub.mode=subscribe` and
  `hub.verify_token` exactly matches the server-owned verify token.
  On any mismatch, 403 with no challenge echoed.
- Delivery signature (`verifyLeadWebhookSignature`): HMAC-SHA256
  over the raw body, header format `sha256=<hex>`, timing-safe
  compare. Missing app secret fails closed
  (`muse_lead_webhook_secret_not_configured`); missing, malformed,
  or mismatched signature fails closed
  (`muse_lead_webhook_bad_signature`). No body or PII is ever
  logged, and no error ever contains a phone number, name, token,
  or signature.

## Tenant mapping (server-owned only)

- The handler takes a server-owned `pageToCompany` mapping:
  page_id → companyId. A company field in the webhook payload is
  **never trusted** — the payload carries no company, and the
  handler has no field for one.
- Unmapped page → `muse_lead_webhook_page_not_mapped`, no fetch,
  no store. A lead stored for company A is invisible to company B:
  the memory store is keyed by leadgen_id + companyId, and the
  future Postgres UNIQUE constraint is on the same pair.
- Deduplication: a second delivery of the same leadgen_id for the
  same company is a no-op. The store is consulted before fetch, so
  a duplicate never re-fetches and never creates a second callback
  record. The same leadgen_id under a different company is a
  different tenant's record only if that company legitimately maps
  to that page — mapping, not payload, decides.

## PII minimization and retention

- Stored record, and nothing else: leadgen_id, companyId,
  full_name, phone_number, preferred_callback_date_time, and a
  received timestamp. Raw page/form/ad identifiers are not stored.
- Consumer-facing output (`toConsumerCallbackSummary`) strips raw
  IDs and PII entirely: companyId, status `callback_requested`,
  and receivedAt only — no leadgen_id, page_id, form_id, ad_id,
  name, or phone number.
- Retention is callback-purpose only: keep a callback record only
  as long as needed to make the callback and record its outcome,
  then delete or anonymize it per the business's policy. Do not
  feed callback records into retargeting, training data, or any
  other feature, and do not log phone numbers or names anywhere.
- Test fixtures only: tests use the conventional TEST phone range
  (`+15555550199`-style), labelled TEST. No real consumer, lead,
  or callback data appears in code, tests, or docs.

## What this feature is NOT

- Not a purchase, approval, draft, execution, or order path.
- Not a mounted route, not a live endpoint, not a live Graph fetch.
- Not a storefront, cart page, checkout page, or product-listing
  surface. The consumer purchase surface remains the Muse feature
  panel in a Muse window; this webhook is a business-side callback
  intake only.
- Not a claim that Meta has approved `leads_retrieval`, that a
  leadgen subscription exists, or that any lead has been received.

## Mount checklist (future step, not done here)

1. Server-owned verify token + app secret in a secret manager;
   HTTPS endpoint in the Meta app dashboard, `leadgen` subscribed.
2. `pageToCompany` supplied from server-owned Page → company
   records, never from a payload.
3. `fetchLead` supplied with a server-owned, tenant-scoped Page
   Access Token from a secret manager; Graph version `v26.0`.
4. Route mounted in `index.ts` with the handler's fail-closed
   order intact, plus a test lead round-trip in Development Mode
   before any App Review submission for `leads_retrieval`.
5. Retention / deletion policy for callback records, agreed with
   each business tenant, before any other business's leads are
   accepted.
