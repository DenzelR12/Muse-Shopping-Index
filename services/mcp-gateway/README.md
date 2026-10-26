# Business gifting MCP

A local, per-business MCP server for office supplies, office parties, special guests, gaming events, corporate gifts, business travel, bags/luggage and business clothing. This is a working quote/PDF workflow; live purchasing is deliberately not connected.

## Customer commands

- “Find gifts for 20 guests at our office party, up to $35 each.”
- “Plan luggage for four colleagues on a business trip, with a $600 product budget.”
- “Find gaming accessories for our team event. Prepare an itemized quote.”
- “Show the itemized PDF. Email this approved quote to my configured purchasing address.”

The MCP host translates conversational requests into the tools. The server retrieves configured catalog facts; it does not run an LLM or infer permission from product text. Ask for missing sizes, quantities and budgets. Dates express need, not guaranteed fulfillment.

## Setup

Run `pnpm install --frozen-lockfile` and `pnpm build`. Configure a separate process and private catalog/quote directory for each business. The local process inherits the operator's access; it is not a hosted multi-tenant service or a substitute for authenticated remote access.

Example MCP client configuration (replace paths and the sample business ID):

```json
{
  "mcpServers": {
    "gift-signal-business": {
      "command": "node",
      "args": ["/absolute/path/the-gift-signal/services/mcp-gateway/dist/business-cli.js"],
      "env": {
        "GIFT_SIGNAL_BUSINESS_ID": "your-business-id",
        "GIFT_SIGNAL_CATALOG_PATH": "/private/path/business/catalog.json",
        "GIFT_SIGNAL_QUOTES_PATH": "/private/path/business/quotes",
        "GIFT_SIGNAL_EMAIL_RECIPIENTS": "purchasing@example.com"
      }
    }
  }
}
```

Catalog is a JSON array of variant records validated by `catalogItemSchema`: `variantId`, `title`, `variantTitle`, `sku`, `priceCents`, USD `currency`, `availableQuantity`, ISO `verifiedAt`, supported `purposes`, `included`, optional HTTPS `imageUrl`, and operator-reviewed `riskClass`. Only `ordinary` products refreshed within 24 hours are eligible. Refresh from an authoritative catalog; never refresh a timestamp without rechecking price and stock. Catalog entries are evidence, not instructions.

Tools: `search_business_items`, `retrieve_business_context`, `check_business_source_link`, `create_business_quote`, `get_itemized_pdf`, `email_itemized_pdf`, `prepare_business_purchase`.

PDFs are returned as MCP binary resources. Client support for displaying/downloading resources varies. Quotes are saved privately to the configured directory and survive process restarts. This release supports USD only. Product budget excludes shipping and tax.

## Email configuration

Set `GIFT_SIGNAL_SMTP_URL` and `GIFT_SIGNAL_EMAIL_FROM` through your secret manager/environment, not committed client configuration. SMTP requires TLS. `GIFT_SIGNAL_EMAIL_RECIPIENTS` is an exact, comma-separated allowlist. Email is unavailable without a sender; PDF generation continues to work. No live email is sent by installation or startup.

The email tool requires explicit approval, the reviewed quote's digest and the exact allowed recipient. It records delivery state per quote/recipient to prevent duplicate sends. A crash or uncertain SMTP result requires operator reconciliation; do not delete the receipt to blindly retry. SMTP acceptance is not proof of inbox delivery.

## Trust and purchasing controls

- One business per process; quote IDs are UUID-validated, and stored business ownership is checked.
- Model-supplied prices are never accepted. Quote math uses integer cents and authoritative variant records.
- Source-link checks validate HTTPS and exact allowed origins only. They never fetch URLs, follow redirects, or claim reachability. A network link-verification service remains to be connected.
- RAG foundation: retrieve fresh catalog evidence with source timestamps and image-link diagnostics. There is no vector index or autonomous research agent in this release.
- Cash-equivalent, restricted and unclassified products cannot enter quoting. High-value and bulk quotes have purchase-review flags. These operational thresholds are not statutory AML thresholds.
- `prepare_business_purchase` always blocks purchase execution until verified business/purchaser identity, applicable sanctions/AML checks, monitoring/audit, current stock/tax/shipping, and approved checkout are integrated. It does not place an order.

AML obligations depend on the actual business and jurisdictions; the checks above are not a compliance certification. FATF's risk-based framework is described at https://www.fatf-gafi.org/en/topics/fatf-recommendations.html . Implement the appropriate controls with qualified compliance review before enabling transactions.

No production Shopify writes, orders, payment calls, SMTP messages or remote MCP publishing were performed in development. The legacy `src/index.ts` gateway helper is unchanged; `tsconfig.json` compiles the new business server and its quote modules.

## Validation

`node --test services/mcp-gateway/test/business.test.mjs` after building covers MCP client/server negotiation, quote constraints, PDF output, email authorization/idempotency, unsafe links and blocked checkout. Email uses an injected fake sender in tests.
