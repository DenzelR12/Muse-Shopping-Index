# Storefront and Business Bundle UI

## Storefront

The customer flow is Recipient -> Occasion -> Interests -> Budget -> Deadline. Results present three bundle choices: BEST COMPLETE CART, SMARTER VALUE CART, and UPGRADE THE SIGNAL.

Each bundle card shows the included products, total price, target budget, budget utilization, delivery evidence when available, and a plain-language section titled Why these work together.

Customer actions include view bundle, remove item, swap item, add bundle to cart, and start checkout. Those actions feed the bundle learning layer using the existing telemetry contract.

## Business

The Business control plane shows bundle requests, generated bundle candidates, budget utilization, item removals, swaps, cart additions, checkout starts, purchases, and exception counts.

Operators can inspect recommendation context and evidence, but Business does not become the recommendation engine or payment authority. Gift Intelligence remains the ranking layer and Signal Shield remains the deterministic policy boundary.

## Guardrails

Hard-budget requests never display a bundle above the target. Delivery claims require verified fulfillment evidence. Product identity, price, availability, and semantic context come from authoritative catalog state. The UI never invents reviews, scarcity, supplier claims, delivery confidence, or product identifiers.
