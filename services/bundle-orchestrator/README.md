# Bundle Orchestrator

Coordinates budget-aware Muse Shopping Index bundle generation across Business, API, and MCP surfaces. ("Storefront" appears in this service only as a legacy bundle-source telemetry label, retained as an internal identifier — it is not a product surface. The product surface is a Muse feature panel mounted by a Muse host inside a Muse window/surface.)

Responsibilities:
- accept recipient, occasion, budget, deadline, and candidate-product context;
- request bundle plans from Gift Intelligence;
- preserve hard-budget versus target-budget behavior;
- keep bundle roles complementary rather than redundant;
- emit bundle lifecycle telemetry through the shared telemetry package;
- keep customer-facing rationale tied to real product and fulfillment evidence.

This service does not authorize payments, alter checkout totals, or invent delivery confidence. Payment and risk decisions remain behind the payments service and Signal Shield.