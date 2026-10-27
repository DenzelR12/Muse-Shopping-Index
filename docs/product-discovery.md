# Product discovery and holiday gifting

There is no storefront product surface. The legacy storefront app in this repo is a draft preview only (LEGACY — NOT THE PRODUCT SURFACE), not a deployed store or live checkout, and the product surface is a Muse feature panel mounted by a Muse host inside a Muse window/surface. Two catalog examples use actual Shopify CDN photographs and source facts checked on September 13, 2026. They are explicitly separate from the illustrative planner bundles. Prices and stock must be refreshed before checkout. No Shopify records were changed.

The Gift Intelligence product contract now carries variant identity, photographs, inclusion details, brand, attributes and source timestamps. The Shopify adapter preserves the selected available variant and filters out images explicitly assigned to a different variant. Business exposes `productContextHealth` to identify missing context. Recommendations retain these fields and no longer invent delivery confidence when it is absent.

Holiday planner entry points include Christmas, Hanukkah, Diwali, Thanksgiving hosting, New Year and employee appreciation. Occasion fit must come from supported product context; a holiday selected by a shopper does not make every product suitable. Avoid religious, dietary, sizing or delivery assumptions.

Before launch, connect authoritative catalog refreshes and variant selection to the planner, replace illustrative bundle items, and render individual product pages with consistent visible facts and Product/Offer markup. Refresh price, currency, stock, images and URLs together. Confirm seller shipping and return policies. Do not publish old catalog snapshots as live offers.

OpenAI recommends factual descriptions, stable product and variant IDs, and variant-specific media and pricing when these differ. Product-feed onboarding currently requires approved-partner access: https://developers.openai.com/commerce/guides/best-practices . No feed has been submitted by this work.

The prepared robots file allows OAI-SearchBot. Production crawling also depends on deployment and hosting access: https://developers.openai.com/api/docs/bots . Google documents product markup and merchant feeds here: https://developers.google.com/search/docs/appearance/structured-data/product . Neither crawl access nor structured data guarantees first place. Measure discovery, relevant impressions, product views and conversion after launch.
