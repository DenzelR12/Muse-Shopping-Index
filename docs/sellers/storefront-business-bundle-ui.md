# Storefront and Business Bundle UI

> LEGACY — NOT THE PRODUCT SURFACE. This document describes the
> bundle UI of the legacy storefront app carried over from the
> source copy. It is NOT the product surface for Muse Shopping
> Index: the product surface is a Muse feature panel mounted by
> a Muse host inside a Muse window/surface
> (`apps/demo/src/muse-feature-panel.ts`), and the abandoned
> "cart" is a Muse draft in a Muse window, not a storefront
> cart. This document is kept as a record of the legacy bundle
> UI; it does not describe the Muse feature.

## Storefront

The customer flow is Recipient -> Occasion -> Interests -> Budget -> Deadline. Results present three bundle choices: BEST COMPLETE CART, SMARTER VALUE CART, and UPGRADE THE SIGNAL.

Each bundle card shows the included products, total price, target budget, budget utilization, delivery evidence when available, and a plain-language section titled Why these work together.

Customer actions include view bundle, remove item, swap item, add bundle to cart, and start checkout. Those actions feed the bundle learning layer using the existing telemetry contract.

## Business

The Business control plane shows bundle requests, generated bundle candidates, budget utilization, item removals, swaps, cart additions, checkout starts, purchases, and exception counts.

Operators can inspect recommendation context and evidence, but Business does not become the recommendation engine or payment authority. Gift Intelligence remains the ranking layer and Signal Shield remains the deterministic policy boundary.

## Guardrails

Hard-budget requests never display a bundle above the target. Delivery claims require verified fulfillment evidence. Product identity, price, availability, and semantic context come from authoritative catalog state. The UI never invents reviews, scarcity, supplier claims, delivery confidence, or product identifiers.
