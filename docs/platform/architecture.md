# Architecture

The maintained system architecture is in [Technical documentation: system architecture](../technical/system-architecture.md).

Muse Shopping Index is a company-agnostic intelligence and transaction authority layer for Muse. Authorized company adapters supply catalog, live quote, execution and lifecycle capabilities. Deterministic server controls enforce identity, grants, exact human approval, payment binding and recovery. Stripe/Shopify are the current concrete payment/order reference implementation, not universal company requirements.

See also:

- [Transaction lifecycle](../technical/transaction-lifecycle.md)
- [API and MCP tools](../technical/api-reference.md)
- [Company adapter contract](company-adapter-contract.md)
- [Documentation index](../technical/README.md)

Illustrative click reductions in historical demo materials are not measured conversion or performance benchmarks.
