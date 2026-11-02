# services/fulfillment — library stub, not a deployed service

Status: design-stage library code. This package is a single pure function
(`deliveryConfidence`, scoring a delivery promise from supplier evidence:
stock, tracking presence, dispatch days, late rate). It has no server, no
deployment, and no tests, and it is not a running fulfillment service.
Kept as a scored-evidence building block for the seller/fulfilment design.
