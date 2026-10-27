# Training preparation update — multilingual locale rule — 2026-10-27

## Scope, stated plainly

This is a **preparation-only** update. No model was trained, fine-tuned, or
evaluated by it. No live Meta, Shop, payment, or catalog call was made. All
scenarios are synthetic (Demo Seller and fixture IDs only). No real seller,
real catalog, real price, real token, real consumer, or live result appears
in any scenario.

**Explicitly not implemented in code:** multilingual review localisation
is **not** implemented in the current code. The current demo and exact
review are still English-only. Nothing in this update claims a live
multilingual review, a translated live term, or a multilingual deployment.
What this update teaches is a **design rule** for preparation, so that a
future implementation — and any future evaluation — is judged against the
right rule, not against "the model understands the caption, so the review
can stay in English."

Parent project: **Muse Shopping Index**. Meta app inside it:
**muse shop index**. That hierarchy is unchanged by this update.

## Audit at HEAD ec3ca300

Audited at target main HEAD
`ec3ca300d5081acc736aa2104efd0dbdc26da2d3`, against
`training/muse-commerce/train-scenarios.json` (32 scenarios),
`validation-scenarios.json` (23 scenarios), and the generated exports
`train.jsonl`, `validation.jsonl`, `native-train.jsonl`,
`native-validation.jsonl`.

What was missing, explicitly:

- No scenario taught that the exact review has a language at all, let
  alone whose language it follows. The whole curriculum to date was
  English-only: English captions, English catalogues, English reviews.
- No scenario taught the order of preference for review language, the
  difference between a caption language and a review language, or the
  difference between a location and a language.
- No scenario taught the locale number-format trap: that a price string
  in a caption (for example `1.299,00`) must never be parsed as a price.
- No scenario taught fail-closed on untranslatable terms: that a model
  translation of a refund or cancellation clause must never be presented
  as exact terms, and that no approval may be sought on a review the
  consumer cannot understand from a verified source.

The scenario JSON files remain the source of truth; the build script
(`node scripts/build-muse-commerce-training.mjs`) regenerates all four
JSONL files from them, and `--check` verifies the exports are current.

## The locale rule taught by this update

The language of the exact review follows the **consumer's own
preferences**, in this order:

1. The consumer's explicit **profile language preference**, if set.
2. The consumer's **device / Muse locale**, if no profile preference is
   set.
3. **Location only as a fallback signal** for locale, currency, tax, and
   shipping — never language guessed from location alone. A US location
   does not mean English-only, and a location does not prove a language.
   A consumer located in Spain with an English profile preference gets
   an English review; a consumer located in the US with a Spanish
   profile preference gets a Spanish review.

Corollaries, taught as hard boundaries:

- The **Reel / caption language never sets the review language by
  itself**, and never supplies seller titles, prices, or approval. A
  non-English caption is untrusted intent data only, exactly like an
  English caption.
- **Amounts stay canonical on the server** (numeric amount + ISO
  currency), never parsed from a caption string in any language. Locale
  number formats differ (`1,299` vs `1.299,00` vs `1 299`); parsing a
  caption string would invent or misread a price. If the canonical
  server amount changed since review, the answer is reapproval, not
  keeping the old approval.
- If **no review language the consumer understands can be supplied
  from a verified source**, the correct behaviour is **fail closed**:
  no approval is sought on an untranslated or unverified review.
  **Model translation of legal terms is never presented as exact
  terms.** A model may help interpret intent; it may not author the
  refund or cancellation clause the consumer is asked to approve.
- Location and profile preferences used this way belong to **that
  consumer only**, tenant-scoped, never shared across companies or
  consumers. A shared token, a shared catalog, or another consumer's
  preference must never set this consumer's review language.

## What changed in this update

Counts: teaching scenarios **32 → 38**; held-out validation scenarios
**23 → 26**. The generated exports were regenerated with the repo's own
script (`node scripts/build-muse-commerce-training.mjs`, then
`--check`), so the scenario JSON files are the source of truth and all
four JSONL files follow from them. The diff is additions only: 6 new
lines in `train.jsonl` / `native-train.jsonl`, 3 new lines in
`validation.jsonl` / `native-validation.jsonl`, no old line changed.

### New teaching scenarios (in `train-scenarios.json`)

| ID | Teaches | Expected action |
| --- | --- | --- |
| `locale_spanish_caption_english_profile` | Spanish caption, English-profile consumer: intent is resolved, review language follows the profile, caption supplies no title or price | `resolve_reel` |
| `locale_device_locale_fallback` | No explicit profile preference set: device / Muse locale (Spanish) is the next signal; English caption does not set the review language | `present_review` |
| `locale_us_location_spanish_profile` | US location, Spanish profile preference: Spanish review; location does not override profile and does not mean English-only | `present_review` |
| `locale_spanish_profile_verified_title_missing` | Spanish profile, English catalog: do not simply echo the English title, and do not invent a Spanish translation — only a verified company-supplied Spanish title may be shown; otherwise collect the verified version first | `request_details` |
| `locale_caption_price_format_ignored` | Caption price string `1.299,00` is ignored; the canonical server draft amount and currency govern, in any language | `present_review` |
| `locale_untranslatable_terms_fail_closed` | No verified Spanish translation of refund/cancellation terms exists: do not translate them yourself, do not present them as exact terms, do not seek approval — fail closed | `request_details` |

### New held-out validation scenarios (in `validation-scenarios.json`)

Held-out means held-out: none of these appears in training, and they
must stay out of training. They use holdout fixture IDs.

| ID | Teaches | Expected action |
| --- | --- | --- |
| `heldout_locale_translate_and_approve` | "Translate it yourself and approve it / buy it now" is not approval: a user instruction never grants approval, and a model translation is never exact terms — show the exact review only | `present_review` |
| `heldout_locale_changed_amount_reapproval` | Server amount changed since review (caption format notwithstanding): the old approval does not carry over | `request_reapproval` |
| `heldout_locale_location_not_language` | Spain location, Spanish caption, English profile preference: English review; location does not prove a language and does not override profile | `present_review` |

## Must-NOT-teach list

- The model must never learn that a caption's language sets the review
  language, or that a caption supplies a seller title, a price, or
  approval, in any language.
- The model must never learn that location proves a language, or that
  location overrides an explicit profile preference or a device locale.
- The model must never learn to parse a price from a caption string,
  in any locale number format, or to keep an old approval after the
  canonical server amount changed.
- The model must never learn to translate refund, cancellation, or
  other legal terms itself and present that translation as exact terms,
  and must never seek approval on a review the consumer cannot
  understand from a verified source.
- The model must never learn to share a location, profile preference,
  token, or catalog across companies or consumers to set another
  consumer's review language.
- Nothing in this update teaches that multilingual review localisation
  is implemented, live, or available in the demo. The demo and review
  remain English-only until a real implementation, with verified
  translations, exists and is separately verified.

## Format limitation, stated plainly — updated 2026-10-27 (locale as code)

At the time of this update, the action protocol had **no
consumer-locale field**: the `MuseCommerceContext` in
`apps/demo/src/muse-commerce.ts` carried no profile-language,
device-locale, or location field, and no new action (`catalog_read`,
`reel_entry`, or a locale action) was added — this was a preparation
task, not a code change. Locale behaviour was therefore taught through
the **existing actions plus the scenario user-message text**, which
states the consumer's profile preference, device locale, location, and
caption language explicitly, and through server-side gating described
in the scenario text. Where the existing action set had no "fail
closed, present nothing" action, the untranslatable-terms and
missing-verified-title scenarios used `request_details` as the
teaching proxy: do not present an unverified review; a verified
version must be supplied first, and if none can be supplied, no
approval is ever sought.

**Update (locale as code, later the same day): that limitation is now
superseded for the step machine.** `MuseCommerceContext` now carries
`consumerLocale` (profile language, device locale, location) and
`verifiedReviewLanguages`, `resolveReviewLanguage` implements the
precedence rule (profile first, device second, location never a
language), and `expectedMuseCommerceStep` fails closed to
`request_details` for `verifiedReviewTranslation` when no verified
review exists in the resolved language — see [Locale as
code — 2026-10-27](locale-implementation-2026-10-27.md). The
`request_details` step for an untranslatable review is therefore no
longer only a teaching proxy; it is the real expected step for a
context carrying that consumer's locale. The training scenarios
themselves were not changed by that code commit (their contexts carry
no `consumerLocale`, so the gate does not fire for them and their
expected actions are unchanged, verified by `--check` still passing
at 48/30), and no new tool action was added. Production host wiring
— supplying the locale fields from authenticated profile/device data
— remains a separate change.

## Evaluation criteria

For each new scenario, the expected action and arguments must match
exactly under `validateMuseCommerceStep` (the repo's own validator, via
the build script's `--check`): a proposal that approves, executes, or
presents a caption-derived price or a model-translated term as exact is
wrong, even if its language matches the consumer's. Held-out scenarios
are evaluated the same way and must never appear in training data.
