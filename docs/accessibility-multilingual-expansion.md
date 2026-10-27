# Accessibility and multilingual expansion — market expansion, not charity

## Limits — read first

- **Design + code where it exists, not a standard or an audit.** No
  WCAG conformance claim, no accessibility audit, and no live
  multilingual review or live multilingual UI is claimed here. The
  panel renders real DOM text, but demo rendering is English-only
  today, and the locale gate in the demo step machine fires only for
  hosts that supply trusted locale fields (the production API host
  does not yet supply `consumerLocale` / `verifiedReviewLanguages` —
  see `docs/locale-implementation-2026-10-27.md` and
  `docs/accessibility-abandoned-recovery.md` §8).
- **Muse feature, not a storefront.** The review described here is the
  Muse feature panel mounted by a Muse host inside a Muse window /
  surface. It is never a shop site, cart page, checkout page, or
  product-listing page.
- **Full design:** `docs/accessibility-abandoned-recovery.md`. This
  document is the short expansion argument: why the same features are
  a market expansion, and what is still missing. It does not replace
  that design document.

## 1. The argument in one paragraph

A review that can only be seen as an image, in English only, with a
short expiry and no warning, excludes people — and excluded people are
not a niche. Screen-reader users, voice users, one-handed mobile users,
users in a hurry or in a noisy place, users whose profile language is
not English, and users who need time to read legal terms all fail the
same checkout today, for different reasons. A review that works for
them works for everyone else too, and it opens the product to consumers
who cannot finish today's image-only, English-only checkout at all.
That is a bigger market, not a favour.

## 2. What already exists in code

| Feature | Where | Why it expands the market |
| --- | --- | --- |
| Real-text review in screen-reader order: seller → item/config → ship-to → shipping → tax → total (with visible sum) → payment timing → refund terms → amount-labelled approval ("Approve $X") | `apps/demo/src/muse-feature-panel.ts` | A screen reader, a voice tool, and a translation tool can all read it. An image cannot be read by any of them. |
| Status in words, not colour | Panel status timeline (done / in progress / not yet) | Colour-blind users and screen-reader users get the same status. |
| Reapproval diff in words ("It was $277 USD, now it is $285 USD", "Shipping changed…") plus struck-through old total | Panel + `apps/api/src/muse-abandoned-recovery.ts` (`buildReviewDiff`) | A price change is understandable without seeing a strikethrough. |
| Announced status: one `role="status"` aria-live polite region; assertive only for reapproval / reconciliation | Panel | A change is announced once, not on every re-render, and not as a surprise. |
| Pre-expiry warning in the final 2 minutes of a 10-minute draft life, factual, no countdown, no hurry, "Nothing will be charged automatically" | Panel + resume logic | Users who read slowly, or who were interrupted, are warned before expiry instead of losing the review silently. |
| Resume-by-draft, revalidated first; expired/changed → new draft + diff + fresh approval; approved/executing → execution state, never a fresh Buy | `apps/api/src/muse-abandoned-recovery.ts`, host `resumeDraft` | A closed chat, a dropped connection, or a distraction does not lose or duplicate an order. |
| Reminder opt-in explicit, default OFF, one generic reminder only, one-tap dismiss | Panel + `apps/api/src/muse-reminder.ts` | A reminder that can be dismissed in one tap, with no price or pitch, does not harass users who need more time. |
| Locale as code, fail-closed gate | Demo step machine (`apps/demo/src/muse-commerce.ts`, `resolveReviewLanguage`, `reviewTranslationVerified`) | Review language order: explicit profile language first, device/Muse locale second, location only as a fallback for locale/currency/tax/shipping — never language guessed from location alone. Reel/caption language never sets review language and never supplies facts. Amounts are canonical server amounts (numeric + ISO currency), never parsed from a caption. If no verified review exists in the consumer's language, the gate asks for a verified translation instead of presenting a model translation as exact terms. |

## 3. What is still missing (not claimed)

- Production host wiring of `consumerLocale` /
  `verifiedReviewLanguages` from authenticated profile/device data
  (the gate fires only in the demo step machine and in hosts that
  supply those fields today).
- A live multilingual review UI and a verified translation supply for
  any language beyond the demo's English rendering.
- A live reminder channel (opt-in entry and wiring exist; no channel
  is configured, so no consumer has received a reminder).
- Live panel-to-API routes and a production host actually passing
  bound methods to the panel (see
  `docs/live-panel-routes-design.md`).
- Any accessibility standard, audit, or conformance statement.
- User testing with screen-reader, voice, and multilingual users —
  the expansion claim is an argument and a design, not a tested result,
  until such testing is recorded.

## 4. How expansion would be measured

Only after a live test, using
`docs/impact-measurement-protocol.md`:

- Completion rate split by review language and by assistive-technology
  use (self-reported, opt-in only, never inferred from a device or a
  profile).
- Resume rate and reapproval rate for users who were interrupted
  (expiry and revalidation are the mechanism, not a failure).
- Time to approval reported as a distribution, not a single average:
  a longer approval time for a screen-reader review or a reapproval
  is expected and is not a worse result.
- Zero dark-pattern failures under the impact protocol §7 checklist,
  for every language and every assistive-technology path tested.
