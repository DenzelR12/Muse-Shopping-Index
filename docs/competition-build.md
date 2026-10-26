# Competition build plan

## One-line pitch

**Muse Shopping Index turns any retailer or travel company into a safe, agent-ready service that a customer's existing AI can search, configure and transact with.**

## Demo story

1. User asks Muse for a multi-constraint retail or travel task.
2. Muse calls Muse Shopping Index company connector over MCP/API.
3. Connector searches normalized live/demo offers.
4. Muse Shopping Index builds a reviewable action draft.
5. UI shows exact configuration, price, source evidence and clicks removed.
6. User explicitly approves.
7. Provider adapter revalidates and commits the transaction in demo mode.
8. Audit/telemetry records the full path.

## What judges should see

- Muse/Meta AI is central to the interaction.
- MCP/API connector tools are real and typed.
- Read, draft and commit actions have different risk boundaries.
- Customer permissions can expire or be revoked.
- No model can bypass final approval.
- Retail and travel use the same normalized connector runtime.
- Business value is measurable through click reduction and completion.

## Submission priorities

### Must ship
- connector runtime + tests
- MCP tools
- one working retail demo adapter
- one working travel demo adapter
- competition demo script
- architecture diagram
- CI green
- README with one-command local setup

### Should ship
- connector consent/permission UI
- action draft review UI
- telemetry dashboard for click reduction
- audit event trail
- provider revalidation simulation

### Later
- production merchant OAuth
- real retailer/travel integrations
- enterprise secrets/KMS
- multi-region deployment
- billing and partner onboarding
