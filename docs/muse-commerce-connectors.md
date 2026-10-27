# Muse commerce connector architecture

## Product thesis

Muse Shopping Index is not another consumer AI. It is a permissioned commerce connectivity layer that companies can expose to the AI their customers already use.

**Company enables connector → customer connects their AI → AI receives delegated tools → search/configuration becomes a reviewable draft → purchase or booking requires explicit approval and live provider revalidation.**

This directly aligns with Meta AI Connectors, which let services expose API or MCP tools to Meta AI.

## Why companies care

Retailers and travel brands lose conversion to click friction, repeated form entry, context switching and abandoned configuration flows. A connector lets a customer's agent carry intent through the company's own policies and APIs instead of scraping or guessing.

Primary measurable outcome:

- baseline clicks to complete task
- connector clicks to complete task
- clicks removed
- click reduction percentage
- completion rate
- draft-to-commit conversion
- time to completed task

The code exposes `clickReduction()` so demos and experiments can report this transparently.

## Connector model

Each company gets a `CompanyConnectorManifest` with:

- company identity and vertical
- connector status
- actions the company exposes

Each customer connection contains:

- company + customer relationship
- delegated actions
- opaque secret reference, never credentials in prompts
- creation / expiry / revocation state

Three default actions are deliberately separated by risk:

1. `search_offers` — read-only live search
2. `create_action_draft` — prepare a reviewable purchase/booking
3. `execute_action` — commit only after explicit approval

## Retail example

> "Find my partner a premium carry-on under $400 and buy the best option."

The agent can search the retailer's connector, compare live offers, prepare a signed draft, show the exact price/configuration, then request approval before the commit action. (The draft lives in a Muse window via the Muse feature panel — not a storefront cart.)

## Travel example

> "Plan a theme-park trip for four under $4,000 with two park days and a hotel near the resort."

The agent can search the travel company's inventory, compose a package draft, show dates/price/cancellation terms, then request approval before booking.

The repository intentionally uses generic travel examples. A real Disney integration would require Disney or an authorized partner to expose/authorize the relevant booking APIs and terms.

## Safety boundary

A connector is not authority by itself.

- Customer connection must be active and unexpired.
- Requested action must have been granted by the customer.
- Company must expose the action.
- Commit requires explicit approval.
- Draft must still be valid.
- Provider must revalidate live price, availability, configuration and policies before committing.
- Credentials belong in a secret manager and are referenced by opaque IDs.
- Signal Shield remains the higher-level deterministic policy boundary for privileged actions.

## Meta/Muse competition demo

A strong demo is a side-by-side task:

**Without connector:** 10–15 clicks across search, filters, product/detail pages, forms, cart and checkout.

**With Muse Shopping Index connector:** one natural-language request, one review step, one approval.

Do not fake a production merchant integration. Use a clearly labeled demo adapter for the competition and show exactly where a real retailer/travel API plugs into `CompanyConnectorAdapter`.
