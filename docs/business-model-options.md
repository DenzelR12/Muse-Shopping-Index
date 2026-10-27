# Business model options — Muse Shopping Index

## Limits — read first

- **Options only. No model is decided.** No fee, commission,
  subscription price, revenue share, or revenue model exists in the
  source or target today, and none is chosen by this document. The
  user decides; this document exists so that decision is made with
  its trade-offs in view, not by accident in a demo script.
- **No numbers are facts.** No fee level, percentage, price, or
  revenue figure appears in this document as a fact, and none is put
  in code or in the submission brief as a fact. Any number added later
  must be added by the user's decision, with its date, or it does not
  count.
- **Test mode first.** Whichever option is chosen, it is validated in
  test mode first, with no real money, and real money only with
  explicit approval of the exact transaction. A business model is not
  a reason to weaken exact approval, consume-once, drift reapproval,
  reconciliation, raw-ID handling, or tenant scoping.
- **Muse feature, not a storefront.** The product being monetized is
  a Muse feature (Reel → Muse window → exact review → one approval →
  server execution), not a storefront, shop site, or product-listing
  site. A model that requires the project to become a storefront is
  not compatible with the product, and is not listed as viable below.

## Option A — Fee only on a verified order

| Item | Detail |
| --- | --- |
| How it works | The seller (or the platform, where authorized) pays only when the server records a verified order. Submitted, processing, and abandoned drafts pay nothing. Refunded orders subtract, in the same way BI revenue subtracts refunds. |
| Pros | Aligned with the seller: no value, no fee. Aligned with the verified-only revenue rule already in BI. Lowest barrier for an indie seller to try the pilot. |
| Cons / risks | Revenue arrives only after the whole chain works, including seller fulfilment — a slow or unreliable seller delays revenue that is not the product's fault. Requires a trusted, auditable verified-order record per tenant, and a payment flow for the fee itself that is separate from the consumer's payment and never mixed with it. |
| What it needs to be real | A fee-collection path (separate from consumer checkout), per-tenant verified-order accounting, and a refund rule agreed with each seller before the first test order. |

## Option B — Seller subscription

| Item | Detail |
| --- | --- |
| How it works | A company pays a recurring subscription for access to the Muse feature, the panel, the catalog adapters, and the BI reporting for its own tenant. Usage (verified orders, resumed drafts) is reported, but does not change the price unless a tier is separately agreed. |
| Pros | Predictable for both sides; no per-order accounting dispute; works even for sellers whose orders are infrequent or high-touch. |
| Cons / risks | A subscription is a barrier for the smallest indie sellers — the very sellers the pilot is designed for. A flat price must not become a reason to let one tenant's data, catalog, or reminder reach another tenant; tenant scoping is not a tier feature. Churn risk if the first months have no verified orders. |
| What it needs to be real | A tier definition (what is included, what is not), a billing path separate from consumer payments, and a free or test-mode tier for the pilot so the pilot is not blocked by billing. |

## Option C — Platform / Shop backend share, only where authorized

| Item | Detail |
| --- | --- |
| How it works | Where Shop (or another backend partner) handles post-approval notifications, verification, email, and shipping, and where that partner authorizes a share, the project receives a share of the backend handling value for orders it originated and that reached verified status. |
| Pros | Aligned with the product's own description (Shop handling the backend where authorized); the seller does not pay twice for the same handling. |
| Cons / risks | **This option does not exist today.** No Shop partnership, backend handling agreement, identity agreement, or share agreement is in place, and none is claimed. It cannot be the plan for the submission, and it cannot be presented as revenue until a partner authorizes it in writing. It also depends on another party's fulfilment quality. |
| What it needs to be real | A written partnership / backend / identity agreement, a verified-order attribution rule both sides accept (one outcome per draftId, tenant-scoped), and a reconciliation path for disputed attribution. |

## Option D — Hybrid: subscription for the platform, fee only on verified orders for scale

| Item | Detail |
| --- | --- |
| How it works | A small subscription covers platform access and reporting; a verified-order fee applies only above an agreed threshold, or only for sellers who choose it instead of a higher subscription tier. Both parts follow the verified-only rule; neither part charges for abandoned, submitted, or unverified drafts. |
| Pros | Balances predictability (subscription) with alignment (verified-only fee); lets small sellers start on the subscription alone and lets large sellers pay for scale. |
| Cons / risks | The most complex to explain in one sentence, and a judge or a seller will ask which part dominates. Complexity in pricing is also complexity in accounting, disputes, and refunds. If the hybrid is chosen, the one-sentence version must still be true: no fee is charged for an unverified order. |
| What it needs to be real | Everything in A and B, plus a single agreed rule for which part applies when, written before the first seller is charged. |

## Options not listed, and why

- **Advertising or retargeting revenue from abandoned drafts.** Excluded
  by the product's own rules: an abandoned draft is never fed into
  retargeting or any ad system, and a reminder is generic, one-only,
  and opt-in only. Monetizing abandonment would break the trust the
  panel is built on.
- **Selling consumer or seller data across tenants.** Excluded by
  tenant scoping: one company's credentials, orders, and reports can
  never be read or used by another company, and a consumer can only
  ever see their own orders.
- **A fee on a model, caption, or referral click.** A click is not a
  verified order, a caption is untrusted, and a model cannot grant
  payment authority. Charging for any of those would reward the
  parts of the system that are explicitly not authoritative.

## Decision needed

- [ ] Which option (A, B, C, or D) — user decision only.
- [ ] Fee / subscription level, if any — user decision only, never
      invented here.
- [ ] Refund rule for the chosen option — agreed with each seller
      before the first test order.
- [ ] Whether the pilot runs on a free / test-mode tier regardless
      of the option chosen (recommended: yes, so billing never blocks
      the first verified test order).

Until all four boxes are checked by the user, the submission brief
must keep saying: **business model undecided, no fee or revenue
figure claimed.**
