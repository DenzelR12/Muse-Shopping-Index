# Accessibility and abandoned-chat recovery — Muse Shopping Index

**Status: design document and training preparation only.**
This document describes how the exact review and the recovery of an
abandoned shopping chat *should* work. It is not a claim that any of
it is implemented in code, and it claims **no accessibility standard**
(no WCAG or other conformance claim is made anywhere in this document).
The demo and the exact review remain English-only, and no code was
changed by the update that added this document. Steps that still need
code are marked **code needed** wherever they appear.

The non-negotiable rules from the rest of the project still apply,
unchanged, to everything below:

- The model proposes; deterministic server code authorizes and executes.
- Model text, a caption, a reminder, or a returning chat never grants
  approval, signs a draft, or supplies a seller title or price.
- Approval is explicit, bound to one exact signed draft, and consumed once.
- A changed price, tax, shipping, configuration, terms, or payment
  authorization requires fresh approval.
- Uncertain external completion leads to reconciliation, never a blind
  retry and never a second charge.
- Credentials, approval tokens, and raw provider identifiers never
  appear in consumer text.

## 1. The accessible exact review

The exact review is the one moment the consumer is asked to commit
money. If a consumer cannot read it, hear it, or finish it in time,
their approval is not informed — and the project's central safety
claim fails for that consumer. Accessibility is therefore not a
presentation layer added afterwards; it is a condition of the review
being exact at all.

### 1.1 The review is real text, in a fixed reading order

The review must be rendered as real, selectable, navigable text —
never as an image of text, a screenshot, or a mockup with text baked
in. (The presentation mockups used in demo material are pictures of
a design, not the review itself, and must never be shipped as the
review.)

When read aloud — by a screen reader, by a voice assistant, or by
the consumer reading it themselves — the review must come out in
this order, every time:

1. Seller: the resolved company display name (never a raw provider ID).
2. Exact item and configuration: title, variant, options, quantity.
3. Ship-to / pickup / venue / service location, in full.
4. Shipping and other fees.
5. Tax.
6. Total and currency, with the sum visible: subtotal + shipping +
   tax = total.
7. Payment timing: when money is taken.
8. Refund and cancellation terms, in plain language first.
9. The approval action itself, labelled with the amount — for
   example, **"Approve $277"** — never a bare "Approve" or "Buy"
   that forces the consumer to remember the total from elsewhere.

Anything the review cannot resolve to a real display value fails
closed, exactly as it does today: no raw ID, no guessed title, no
guessed price is shown in place of a missing fact.

### 1.2 Status changes are announced in words, not colour alone

Every state change after approval must be *announced* as text, not
merely recoloured:

- Approved → payment verified → shipped → delivered.
- Reconciliation required, with what happens next and that no second
  charge will be made.
- Refund required → executing → submitted → verified refunded
  (submitted is not verified refunded).

The reapproval case is the sharpest version of this rule. A price
change must never be communicated by colour alone ("it turned red").
It must be stated in words, with the old total struck through **and**
described, for example:

> "The total changed. It was $277, now it is $285. Shipping changed
> from $8 to $16. Your old approval no longer applies. Review the
> updated total and approve again."

The same rule applies to any other changed term: name what changed,
give the old value and the new value, and say plainly that fresh
approval is required.

### 1.3 The review must be operable without a mouse or a screen

- The approval action must be identifiable and activatable by
  keyboard and by voice control, with a label that names the action
  and the amount. Focus order follows the reading order in §1.1.
- **Focus returns to the review on resume.** When a consumer comes
  back to an existing draft (see §2), focus lands on the review
  itself, not on the top of a new page, a product list, or a fresh
  Buy button.
- **One-thumb layout, large touch targets.** The primary action
  sits in the bottom third of the screen, as in the existing mockup
  direction, with a target large enough to hit reliably and a
  clear disabled/processing state while a Buy attempt is in flight.
- **One batch of missing details.** Size, quantity, dates, guests,
  seats, options, and ship-to are collected in a single consolidated
  batch, never as a drip of questions that punishes a slow reader
  or a switch-control user with repeated round trips.
- **Plain language.** The review uses short sentences and ordinary
  words first. Legal terms are linked, not dumped into the review
  body, and a term the consumer has not been shown cannot be part
  of the approval.

### 1.4 No timeout trap

Draft expiry is real and necessary: a price or stock position from
an hour ago cannot be approved as if it were current. But expiry
must not punish the consumer who reads slowly, uses a screen reader,
or uses switch control:

- Expiry must be **generous**, and the consumer must be warned
  **before** expiry, in text, with enough time to act.
- When a draft expires, the outcome is revalidation and a fresh
  review — never a lost order presented as a failure, and never a
  silent auto-retry or an auto-approval of the new terms.
- A consumer who needs more time must be able to re-open the same
  flow and get a current review, not be forced to start the whole
  product search again (see §2.2).

### 1.5 Reel and video: pausable, captioned, transcribed

- A Reel playing behind a sheet must be pausable, and it must not
  auto-play sound. Motion in the sheet must respect a reduced-motion
  preference where the host surface supports one.
- **Captions and a transcript are required for the Reel and for
  any demo or submission video.** This is a stated gap, not a
  claim: the current 90-second submission cut has narration but
  **no captions yet**. Adding captions is a separate polish step;
  until then, the cut must not be described as captioned or as
  accessible.

### 1.6 What this document does not claim

No conformance with WCAG, Section 508, EN 301 549, or any other
accessibility standard is claimed, and no audit has been performed.
The design above is a set of requirements for a future implementation
and evaluation, not evidence that the current demo meets them.

## 2. Abandoned-chat recovery, by abandonment point

"Abandoned chat" means the conversation ended before the flow
completed. Recovery depends entirely on *where* the consumer stopped,
because what exists at each point is different. The table below is
the whole design; the sections after it explain each row.

| Where they stopped | What exists | What recovery does |
| --- | --- | --- |
| After intent, before details | No draft | Nothing to recover. No reminder. A new intent is a new flow. |
| At the exact review, no approval | An unapproved signed draft | Return to the same review if unchanged and unexpired; otherwise revalidate and show a new review with a diff. Fresh approval required either way. |
| After approval, during execution | An approved draft + an execution state | Resume by draft: processing / completed / reconciliation / reapproval. Never a fresh Buy, never a second charge. |
| After approval, authentication required | An approved draft + `PAYMENT_FALLBACK_PENDING` | Trusted Checkout fallback only, bound to the same draft. |

### 2.1 The draft, not the chat, is what survives

A chat transcript is fragile: the window closes, the phone sleeps,
Muse restarts, the conversation is lost. The signed draft is not.
It is stored server-side, keyed to the **consumer and the company**
— never to a chat session, a device, or a caption — and it lives
until its expiry, tenant-scoped to that consumer and that company
only.

That single fact is what makes recovery possible at all, and it is
also what bounds it: recovery can only ever return the *same*
consumer to *their own* draft for *their own* company. A draft
belonging to another consumer or another company is not visible,
not resumable, and not usable as evidence for anyone else.

### 2.2 At the exact review, no approval given

This is the largest recovery opportunity, and the most
misunderstood. Nothing has been approved yet, so there is nothing
to "complete" — there is only a review to return to.

1. **Check for an existing owned draft first.** When the same
   authenticated consumer re-enters Muse, the entry path checks
   for an existing owned draft before starting a new search.
   (This is already the entry simulator's `EXISTING_DRAFT_SERVICE`
   step in demo form.) If one exists, the consumer returns to
   `present_review` — the exact review — not to a product list,
   not to a new intent, and not to a fresh Buy button.
2. **Revalidate before re-showing.** Before the review is shown
   again, live provider state is revalidated: price, tax,
   shipping, configuration, stock, and terms.
   - **Unchanged and unexpired:** show the same exact review.
     The consumer still has to approve it explicitly; returning
     to the review is not approval.
   - **Expired, or anything changed:** the old review is
     **never carried over and never shown as current**. A new
     draft is built, the new review is shown with the diff
     stated in words (§1.2), and fresh approval is required.
     An approval that was never given cannot be "kept", and an
     approval bound to old terms cannot be transferred to new
     ones.
3. **Focus and reading order on return** follow §1.1 and §1.3:
   focus lands on the review, in reading order, so a returning
   screen-reader or keyboard user does not have to hunt for it.

### 2.3 After approval, during execution

The buy guard already defines this behaviour, and recovery must
not weaken it:

- Resume by draft returns the true execution state — processing,
  completed, reconciliation required, or reapproval required —
  and the interface follows that state.
- It never resets to a fresh Buy button after a dropout, and it
  never issues a second execution for the same approval.
- Uncertain completion stays in reconciliation, with a human
  path, not a blind retry.

A consumer who approved, closed the chat, and came back must see
*what happened to their approved order*, not be asked to approve
or buy it again.

### 2.4 After approval, authentication required

If execution reached `PAYMENT_FALLBACK_PENDING`, recovery offers
only the trusted payment-rail authentication for the selected
adapter (trusted Stripe Checkout for the Stripe adapter), bound
to the same draft. It never offers a merchant checkout link, a
merchant app download, or a new payment flow invented by the
model or the reminder.

## 3. Re-engagement: one reminder, with consent, and generic

Recovery inside Muse (§2) is passive: it works when the consumer
comes back. Re-engagement is active: something reaches out. It
therefore needs stricter rules, because an unsolicited message
that pressures a consumer into a purchase is a dark pattern even
when the purchase itself would be safe.

### 3.1 Opt-in only, at the review stage, and only once

- At the exact review — and only there — the consumer may be
  offered an explicit **"remind me"** choice. It is **not** a
  default, not pre-checked, and not bundled into approval.
  Approving a purchase is not consent to reminders, and asking
  for a reminder is not approval of a purchase.
- If the consumer opts in, **one** reminder may be sent. Not a
  sequence, not a drip campaign, not a "last chance" series.
- The reminder goes through an **authorized channel only**: Shop
  or email where Shop is the authorized channel for that company.
  No other channel, and no channel the company has not authorized,
  may be used.

### 3.2 The reminder says almost nothing, on purpose

The reminder message is deliberately generic, for a safety reason
as well as a politeness one: any price, seller claim, or product
detail in a message sent hours later may already be stale, and a
message is not an exact review. So the reminder contains:

- That a review is waiting in Muse.
- How to open Muse and return to it.

And it contains **none** of the following:

- No price, total, discount, or "you save" figure.
- No seller claim or product claim.
- No "Buy now", "Complete your purchase", or any other pitch
  that treats the purchase as already decided.
- No link that itself acts as approval, and no draft details
  that would let anyone holding the message act on the draft.
  The message opens Muse; Muse authenticates the consumer and
  revalidates the review (§2.2) before anything can be approved.

A reminder that contains a price is not a reminder — it is an
out-of-date review, and it must not be sent.

### 3.3 No dark patterns, stated explicitly

None of the following may be used to recover an abandoned chat,
in a reminder, in Muse, or anywhere else in the flow:

- No fake countdown ("offer ends in 10 minutes") unless a real,
  verified deadline exists and is shown as part of the exact terms.
- No fake stock ("only 1 left") unless stock is verified live
  at that moment.
- No discount lure. A discount changes the price, and a changed
  price requires a new draft and a new exact review (§2.2) — it
  cannot be dangled in a message and then honoured silently.
- No repeated nudges, no escalating urgency, no guilt language.
- One-tap dismiss and opt-out, honoured immediately, with no
  further reminder for that draft.
- No model-written persuasion text. The reminder text is a fixed,
  reviewed template, not generated copy.

### 3.4 Privacy: an abandoned draft is never retargeting data

An abandoned draft must **never** be fed into Meta ad retargeting,
into any other company's view, or into any advertising audience:

- Recovery is for that consumer, in Muse, for that draft only.
- Draft data is retained only for its expiry window, tenant-scoped
  to its consumer and company, and is not shared across companies
  or consumers.
- Abandonment is not consent to be advertised to. A consumer who
  left a review unapproved has not agreed to see ads for that
  product, and no system in this project may treat them as if
  they had.

This is also a product-trust point: the privacy sentence the
project makes to companies and consumers — that each company's
credentials, orders, and reports are keyed to its own authenticated
identity and can never be read or used by another company, and
that each consumer can only ever see their own orders — would be
broken by the first retargeting use of an abandoned draft.

## 4. The link: accessibility abandonment

A large share of abandonment is not indecision. It is a review
that could not be heard, could not be read, could not be finished
in time, or could not be returned to without starting over.

That is why §1 and §2 belong in the same document and the same
design:

- A review rendered as real text, in reading order, with its
  total and terms announced, can be completed by a screen-reader
  user who would otherwise abandon at the review.
- A generous expiry with a warning before it, and a resume path
  that returns to the review instead of restarting the search,
  recovers the slow reader who would otherwise be timed out.
- A reapproval diff stated in words recovers the consumer who
  would otherwise abandon at a changed price they could not
  understand.
- A generic, single, consented reminder recovers the consumer
  who was simply interrupted — without pressuring the consumer
  who left deliberately.

Reminders recover the interrupted. Accessible review and unhurried
resume recover the excluded. The second group is larger, and it is
recovered without pressure, which is why it comes first in this
design even though it is harder to build.

## 5. Measurement — honestly

Recovery must be measured, but only in terms that are actually
true before a payment is verified:

- **Resumed drafts / abandoned reviews:** of the reviews left
  unapproved, how many were returned to.
- **Time to resume:** how long between abandonment and return,
  so that expiry windows can be set from evidence rather than
  guessed.
- **Reapproval rate due to drift:** of resumed reviews, how
  many needed a new draft because price, tax, shipping,
  configuration, or terms had changed. A high rate here means
  expiry is too long or revalidation is too slow, not that
  consumers are indecisive.
- **Reminder performance, separately:** opt-in rate, single
  reminder open/return rate, and opt-out rate. A reminder that
  drives opt-outs is failing, however many returns it produces.

**Never counted before verification:** "recovered revenue",
"recovered orders", or "recovered sales". A resumed review is not
a sale, a reapproved draft is not a payment, and a reminder return
is not an order. Payment and order are counted only when verified,
exactly as everywhere else in this project.

## 6. Evaluation proposed (not claimed as done)

None of the following has been run. Each is proposed as the
evaluation that would make this design credible, and each must be
reported with its failures, not just its passes:

1. **Screen-reader-only walkthrough** of the exact review and
   of the reapproval diff, with no mouse and no screen: can the
   consumer hear, in order, the seller, item, ship-to, fees,
   tax, total, timing, terms, and the amount-labelled approval?
2. **Keyboard-only walkthrough** of the same two screens, with
   no mouse: can the consumer reach the review, the terms, and
   the approval action, and does focus return to the review on
   resume?
3. **Dropout-and-resume walkthrough** at each point in §2: close
   the chat at the review, after approval, and during execution,
   and return. Does each return show the correct state, and does
   none of them offer a fresh Buy or a second charge?
4. **Reminder audit:** one consented reminder, generic text only,
   one-tap opt-out honoured, and no reminder sent without opt-in.
   Any price, pitch, or second reminder is a failure.
5. **Retargeting audit:** confirm no abandoned-draft data leaves
   the tenant boundary for advertising. Any such flow is a
   failure, not a feature.

## 7. Must-not-teach list

For the training scenarios that accompany this document, the
following must never be taught, by example or by implication:

- A review as an image, a screenshot, or text that cannot be
  read aloud in order.
- A status or price change communicated by colour alone.
- An approval button without the amount in its label.
- A draft expiry that silently loses the order or auto-retries.
- A return that restarts the search, offers a fresh Buy for an
  approved draft, or charges a second time.
- An old, expired, or changed review carried over without
  revalidation and fresh approval.
- A reminder sent without opt-in, a second reminder, a reminder
  containing a price or a buy pitch, or a reminder that itself
  approves anything.
- An abandoned draft used for advertising, retargeting, or any
  cross-company or cross-consumer purpose.
- A "recovered revenue" claim for a resumed review or a returned
  reminder before payment is verified.
- Any accessibility standard claimed as met, audited, or
  certified.

## 8. Explicit limits of this document

- **This is a Muse feature, not a storefront.** The product
  surface for everything in this document is the Muse feature
  panel (`apps/demo/src/muse-feature-panel.ts`), mounted by a
  Muse host inside a Muse window/surface. There is no
  storefront, shop site, cart page, or checkout page product
  surface; the abandoned "cart" is a Muse draft in a Muse
  window, and `apps/storefront` is legacy demo code marked
  LEGACY — NOT THE PRODUCT SURFACE. Nothing in this
  document is presented as a storefront flow.
- **What is now code (abandoned-chat recovery change,
  2026-10-27):**
  - Real-text exact review renderer with the §1.1 reading
    order, amount-labelled approval, and raw-ID rejection —
    `renderMuseFeatureReviewText` in the panel.
  - Announced status changes in words (aria-live region,
    polite, assertive only for reapproval/reconciliation) —
    `announceMuseFeatureStatus` in the panel.
  - Pre-expiry warning, final 2 minutes of a draft's
    10-minute life, factual expiry time and total, no
    countdown, no "hurry" — `museFeatureDraftExpiryWarning`
    in the panel and `draftExpiryWarning` in the API module.
  - Production resume-by-draft — host `resumeDraft()` in
    `apps/api/src/muse-agent-host.ts` plus
    `resumeDraftDecision` / `revalidateAndResume` in
    `apps/api/src/muse-abandoned-recovery.ts`: owned draft
    → review again; expired/changed → new draft + diff +
    fresh approval; approved/executing → execution state,
    never a fresh Buy, never a second execution.
  - Reminder UI opt-in entry — explicit "Remind me"
    checkbox in the panel at review stage, default OFF,
    never pre-checked, calling the host handler that calls
    `optInToReminder` with the authenticated principal
    only, plus one-tap dismiss/opt-out; retention
    eligibility (`purgeEligibleReminderRecords`: expired
    draft → record dead, eligible for deletion; no
    retention job is added).
  - Tests: `apps/demo/test/muse-feature-panel.test.ts`
    (DOM-stub based, no browser), `apps/api/test/muse-abandoned-recovery.test.ts`,
    host resume gates in `apps/api/test/muse-agent-host.test.ts`,
    API gates in `apps/api/test/provider-readiness.test.ts`.
- **What remains code-needed, stated plainly:**
  - A native Muse window renderer. The panel is
    host-agnostic DOM for the web surface; rendering
    these same lines inside a native Muse window is a
    separate integration step, gated by Meta approval.
    No Meta API, Muse deep-link scheme, Muse app URL, or
    native Muse integration contract is invented here,
    and native Muse distribution is not claimed as live.
  - A live reminder channel. The server component and
    the panel opt-in entry exist, but no authorized
    channel is configured, so no live reminder is
    claimed and no real consumer has received one.
  - Production host wiring that connects the panel's
    host callbacks to the live API routes (the panel
    itself makes no network call; the host supplies the
    callbacks). Until that wiring lands, the panel is a
    tested presentation module, not a live product flow.
- **No standard claimed.** No WCAG, Section 508, EN 301 549, or
  other accessibility conformance is claimed or audited.
- **Captions gap.** The current 90-second submission cut has
  narration but no captions yet; that is a gap to fix in the
  polish step, not a claim made here.
- **Demo remains English-only.** The multilingual locale rule
  taught in training preparation is a design rule for the future
  review, not a description of the current demo.
- **No live recovery, reminder, or accessible review is
  claimed.** The code above is tested with mocked
  providers and a DOM stub; it is not a live seller, live
  payment, live Shop handling, or live Meta integration.
