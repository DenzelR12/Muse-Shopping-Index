## Change type
- [ ] Application / UX
- [ ] Connector / provider
- [ ] Security / auth / policy
- [ ] Payments / money movement
- [ ] Infrastructure / deployment

## Security boundary
- [ ] No model-supplied identity, permission, price, approval, or payment state is treated as authority.
- [ ] New destructive actions are capability-gated and explicitly approved.
- [ ] Secrets remain server-side and are not logged or returned to models.
- [ ] Replay/idempotency behavior is covered where relevant.
- [ ] Tenant/company scoping is enforced server-side.
- [ ] Provider state is revalidated before any commit.
- [ ] Tests cover failure/forgery paths, not only success paths.

## Deployment
- [ ] CI passes on the exact head.
- [ ] No production credential was committed.
- [ ] Rollback path is understood for security-sensitive changes.
