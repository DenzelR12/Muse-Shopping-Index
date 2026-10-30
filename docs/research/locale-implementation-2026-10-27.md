# Locale as code — 2026-10-27

This document records the step that turns the multilingual locale design
rule from training preparation into real, enforced code. It changes the
step machine in `apps/demo/src/muse-commerce.ts` and its tests. It does
not change any renderer, host, or live service, and it makes no
multilingual UI or live multilingual claim.

## What was true before this change

The multilingual training update (target main `02cb70e5…`, documented
in [Training preparation update — multilingual locale rule —
2026-10-27](training-update-multilingual-2026-10-27.md)) taught the
locale rule only in scenario text, because the action protocol had no
consumer-locale field: `MuseCommerceContext` carried no
profile-language, device-locale, or location field, and the
untranslatable-terms scenarios used `request_details` as a teaching
proxy. That limitation is now superseded for the step machine itself —
see "What changed" below — but the training scenarios themselves are
unchanged by this commit, for the reason given under "Training
scenarios, unchanged".

## What changed

### 1. A consumer-locale field on the trusted context

`MuseCommerceContext` now carries, all optional:

- `consumerLocale?: MuseCommerceConsumerLocale`, with
  - `profileLanguage?` — the consumer's explicit profile language
    preference;
  - `deviceLocale?` — the device / Muse locale (e.g. `es-MX`);
  - `location?` — country/region or similar, used only as a fallback
    signal for locale/currency/tax/shipping.
- `verifiedReviewLanguages?: string[]` — language subtags (e.g. `es`)
  for which the server holds a verified exact review (seller,
  configuration, ship-to, shipping/tax/total, payment timing, refund
  terms) in that language.

Both fields are trusted-server fields. They are never taken from model
text, user text, or a Reel caption, which remain untrusted data. A
model translation is never a verified review, and this list is never
built from model output.

### 2. The precedence rule, in code

`resolveReviewLanguage(locale)` returns, in order:

1. the primary language subtag of `profileLanguage`, if asserted;
2. otherwise the primary language subtag of `deviceLocale`, if asserted;
3. otherwise undefined.

`languageSubtag` normalises a tag or locale to its primary subtag
(`es-MX` → `es`, `EN_us` → `en`) and returns undefined for missing or
malformed values. Location is deliberately never consulted by this
function: a location does not prove a language, and consulting it
would let a country guess override a person's stated preference. The
Reel/caption language is likewise never consulted. Amounts stay
canonical server draft values (numeric amount + ISO currency) and are
never parsed from a caption string in any language or locale number
format — the step machine takes no caption input at all, so a caption
price string such as `1.299,00` cannot move the expected step.

### 3. The fail-closed review gate, in code

`reviewTranslationVerified(context)` is false exactly when a consumer
language preference is asserted (profile or device) and the server
has not supplied a verified review in that language — including when
no verified-review list was supplied at all. When no preference is
asserted (a legacy context, or a context carrying location only),
there is no language claim to gate on and it returns true, preserving
previous behaviour.

`expectedMuseCommerceStep` applies the gate after the draft
expiry/drift check and before any review, approval, or execution:

- gated state → `{action: 'request_details', args: {fields:
  ['verifiedReviewTranslation']}}` — collect the verified version
  first;
- it never returns `present_review` with an unverified or
  model-translated review, and never returns an approval or execution
  step from the gated state — including when a previously verified
  approval exists for a different review language. That approval is
  not carried over; a fresh explicit approval on the verified review
  is required through the normal path once the verified version is
  supplied.

### 4. Validator enforcement

`validateMuseCommerceStep` enforces the gate through the expected
step: in a gated state, a proposed `present_review` or
`execute_approved_purchase` is rejected with
`muse_step_not_authorized` and nothing is dispatched, because the
expected step is `request_details` for the verified translation.
Steps carry no language, locale, or translation keys at all: a
proposal that adds one (`reviewLanguage`, `locale`, `translation`, or
any other key) fails the strict arg-shape check and is likewise
rejected. The validator therefore cannot be bypassed by model prose:
a model-translated review in prose is never the exact review, and
prose can never grant approval, sign a draft, or execute.

`MUSE_COMMERCE_POLICY` text is intentionally unchanged by this commit.
The generated training exports embed that policy verbatim as their
system message, so editing it would rewrite every export line without
changing any enforced behaviour. The rule is enforced in code here and
carried in the trusted `server_context` snapshot, which already states
that server context is authoritative and captions are untrusted. (The
separate prompt-rename step, queued after this one, is the place where
policy text changes and the exports are regenerated together.)

## Tests

New tests in `apps/demo/test/muse-commerce.test.ts` (run by the
competition-demo package test script, `pnpm --filter
@gift-signal/competition-demo test`, which runs all demo tests — the
file is not named as its own line in `.github/workflows/ci.yml`):

- profile preference wins over device locale (verified device
  language does not rescue an unverified profile language);
- device locale used when no profile preference is set;
- US location + Spanish profile → Spanish; Spain location + English
  profile → English; location alone asserts no language at all;
- region subtag matching (`es-MX` profile against verified `es`);
- untranslatable review fails closed: no `present_review`, no approval,
  no execution — even with a previously verified approval — and
  `request_details` for `verifiedReviewTranslation` is the only legal
  step; supplying the verified translation restores the normal path;
- a model step smuggling a language/translation key is rejected;
- a caption price string in another locale format never changes the
  expected step.

Local verification for this commit: strict TypeScript check clean for
the changed files; `apps/demo/test/muse-commerce.test.ts` 15/15 pass
(9 pre-existing + 6 new); `apps/demo/test/muse-tool-agent.test.ts`
14/14 pass (the other consumer of the context); training `--check`
still passes at 48 teaching / 30 held-out, unchanged. No pnpm or
Docker was available in the verification environment, so these runs
used a locally installed TypeScript 5.6.3 / tsx in `/tmp`, not the
repo's `pnpm` scripts, and the repo's own CI run for this HEAD
remains the parent's live-browser check. The full-suite typecheck in
an isolated clone also reports pre-existing, unrelated errors in
other demo files (missing workspace `@gift-signal/shopping-index`
package and `@types/node` resolution); those do not affect the
changed files, whose strict check above is clean.

## Training scenarios, unchanged

No training scenario was edited and no JSONL file was regenerated by
this commit, and counts stay at 48 teaching / 30 held-out. That is
deliberate, not an oversight:

- Scenario contexts do not carry `consumerLocale`, so the gate does
  not fire for them and every scenario's expected action is unchanged
  — verified by the training `--check` still passing at 48/30.
- The multilingual scenarios' text-stated locale behaviour now has a
  code counterpart: their `request_details` step for an untranslatable
  review is no longer only a teaching proxy, it is the real expected
  step for a context that carries that consumer's locale and no
  verified translation. The scenario text remains the teaching
  vehicle; the code is the enforcement.

## What remains NOT implemented

- **Production host wiring.** The API host's `readContext`
  (`apps/api/src/muse-agent-host.ts`) does not yet supply
  `consumerLocale` from the authenticated profile/device, nor
  `verifiedReviewLanguages` from a catalog/draft review store. Until
  that host supplies both, the gate cannot fire in production — it
  fires today in the demo step machine and in any host that supplies
  the fields. Wiring the host is a separate, deliberate change; it
  must source locale from authenticated profile/device data only,
  never from request JSON, captions, or model output.
- **Multilingual review rendering.** The demo review rendering itself
  is still English-only in presentation. This commit adds the locale
  field and the gate; it does not render a translated review, and no
  multilingual UI is claimed.
- **Reminder, real-text renderer, announced status, and production
  resume paths** from the accessibility and abandoned-chat recovery
  design remain code-needed, as documented there. They are not in
  this commit.
- **No live claim.** No live multilingual review, no live seller, no
  live catalog read, and no model training or fine-tuning is claimed
  by this commit.
