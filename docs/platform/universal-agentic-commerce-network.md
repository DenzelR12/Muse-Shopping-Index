# Universal agentic commerce network

## Thesis

Every company should be able to expose a safe connector to the AI its customer already uses.

Muse Shopping Index is the neutral orchestration layer between:

**attention → intent → company inventory → agent reasoning → review → payment → fulfillment**

It is not a replacement assistant, ad network, payment processor or merchant of record by default.

## Universal flow

1. **Attention**
   - A customer taps an ad, product, creator link, email or connected-app surface.
   - The source passes a short-lived signed `CommerceIntentSignal`.
   - Only user-initiated context is accepted.

2. **Intent**
   - Muse interprets what the customer is trying to accomplish.
   - Example: “I like that carry-on, but find the best one under $350 that can arrive before Thursday.”

3. **Connector discovery**
   - Muse Shopping Index resolves the relevant company connector.
   - The customer grants only the actions needed for that company.

4. **Inventory / availability**
   - The company adapter searches live inventory, rates, bookings or service slots.
   - Offers are normalized into the common connector contract.

5. **Agent decision**
   - Muse compares only the returned evidence.
   - The model does not invent stock, price, availability, delivery, policy or merchant claims.

6. **Draft**
   - A purchase or booking is created as an exact reviewable draft.
   - Draft contains offer IDs, configuration, quantity, total, currency and expiration.

7. **Commerce rail**
   - Shopify retail: prefer Shop / Shopify cart and checkout rails when available.
   - Other merchants: Stripe can prepare an authorized checkout/payment session.
   - Travel/booking: provider-native booking rail can be used where necessary.
   - The rail is an implementation detail behind `PaymentRail`.

8. **Approval**
   - The customer sees the exact transaction before commit.
   - Explicit approval is required.
   - Price, availability and configuration are revalidated.

9. **Commit**
   - The provider creates the order/booking and returns its provider reference.

10. **To the door / completed service**
   - Muse Shopping Index follows fulfillment or booking status.
   - Retail can progress PROCESSING → SHIPPED → DELIVERED.
   - Travel can map the same lifecycle to provider confirmation / readiness in a vertical adapter.

## Ad-interest boundary

The platform must not assume access to hidden advertising profiles.

Allowed input:
- campaign / creative identifiers deliberately handed off by the source
- product references
- user-visible intent tags
- the customer's natural-language request
- data the customer explicitly authorized through a connector

Not authority:
- hidden targeting segments
- inferred sensitive traits
- unrelated advertising history
- arbitrary page or catalog text that tries to change permissions

The current implementation signs and verifies user-initiated intent signals in
`services/mcp-gateway/src/business-ad-intent.ts`.

## “Every company” model

A company does not need a bespoke Muse Shopping Index agent.

It implements `CompanyConnectorAdapter`:

- `search()`
- `createDraft()`
- `execute()`

Muse Shopping Index supplies the reusable:
- connector permission model
- MCP interface
- normalization
- risk separation
- approval contract
- click-reduction analytics
- commerce-rail selection
- fulfillment lifecycle
- audit / policy hooks

Company-specific code is limited to mapping its existing systems into those contracts.

## Shopify / Shop

For Shopify-native commerce, prefer platform-native agent commerce capabilities instead of recreating cart/checkout.

Integration target:
- search / catalog
- cart creation and updates
- checkout creation
- customer confirmation
- order status

The `SHOP` commerce rail represents this path.

## Stripe

The `STRIPE` rail is for merchants or verticals where a Stripe-hosted/embedded checkout is the appropriate transaction path.

Rules:
- payment credentials never enter LLM prompts
- checkout session is server-created
- final order state follows asynchronous provider/webhook events
- fulfillment starts from confirmed payment/order events, not client redirects alone
- idempotency is mandatory on commit operations

## Travel

Travel uses the same connector architecture but often commits through provider-native booking APIs.

Example:

> “Book a theme-park trip for four under $4,000 with two park days and a hotel close to the resort.”

Muse can:
- interpret constraints
- search one or more authorized company connectors
- compose an itinerary/package
- produce a booking draft
- show cancellation/price terms
- request approval
- commit through the authorized provider connector

A Disney-style experience is the UX target, not a claim of a Disney integration. A real deployment requires Disney or an authorized partner to expose and authorize the applicable inventory and booking interfaces.

## Core company value proposition

### Distribution
Be usable from the personal AI customers already have.

### Conversion
Reduce discovery, filter, form, cart and checkout friction.

### Control
Keep pricing, inventory, eligibility, policy and commit authority inside company systems.

### Measurement
Track:
- clicks before value
- clicks to completed action
- time to completed action
- search-to-draft conversion
- draft-to-approval conversion
- approval-to-order conversion
- fulfillment completion
- abandonment by stage

## North-star demo metric

**Clicks removed before completed value**

Example:

Traditional journey:
- 12 user interactions

Connector journey:
- 3 user interactions: ask → review → approve

`clickReduction(12,3)` reports 9 interactions removed / 75% reduction.

This metric must be measured from actual demo flows rather than claimed generically.
