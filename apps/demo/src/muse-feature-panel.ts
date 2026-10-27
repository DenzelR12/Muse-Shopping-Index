/**
 * Muse feature panel — abandoned-chat / review / resume.
 *
 * CORRECTION, STATED PLAINLY: this is NOT a storefront, and
 * this panel is NOT a storefront checkout or cart page.
 * apps/storefront is not the product surface for this
 * feature, and this change does not build, extend, or
 * present anything in apps/storefront as the product. The
 * pre-existing storefront confirmation module in this repo
 * is legacy demo code; it is not the product positioning,
 * and this feature does not depend on it.
 *
 * WHAT THIS IS: a host-agnostic DOM panel that a Muse host
 * mounts inside a Muse window/surface. The host supplies
 * the container element, the authenticated principal (used
 * only by the host's own approve/resume/opt-in callbacks —
 * this panel never sees a subject, a company, or a token),
 * the signed draft state as a MuseFeatureReviewSheet, and
 * the callbacks. The panel renders that server state and
 * dispatches those callbacks; the server re-validates
 * everything. The panel itself never grants approval, signs
 * a draft, supplies seller facts, or executes anything.
 *
 * WHAT THIS IS NOT: a native Muse integration. No Meta
 * API, Muse deep-link scheme, Muse app URL, or native Muse
 * integration contract is invented here. Native Muse
 * distribution / window integration remains a separate,
 * Meta-approval-gated step and is NOT claimed as live.
 * A native host must render these same lines, in this same
 * order, from the same sheet — that renderer is still a
 * separate integration step.
 *
 * TRUST BOUNDARIES:
 * - Every fact comes from the state argument, which the
 *   host builds from a signed envelope / owned server
 *   state. The panel never reads a caption, a query
 *   string, localStorage, or model text, and never
 *   supplies a seller, a price, or a term.
 * - Text is set with textContent only. This module never
 *   assigns innerHTML from seller, caption, or model
 *   data, and never builds markup by string-concatenating
 *   facts. (The one structural exception is an <s>
 *   element for a struck-through old total, whose text is
 *   also set with textContent.)
 * - Raw provider IDs are rejected before rendering:
 *   renderMuseFeatureReviewText throws on gid://,
 *   myshopify.com, and acct_ patterns. Payment labels are
 *   exactly 'Saved payment' / 'Shop Pay · Saved payment'.
 * - No dark patterns: no fake stock, no fake countdown,
 *   no discount lure, no repeated nudge, no retargeting
 *   hook, and no price or seller pitch in the reminder
 *   UI. The pre-expiry banner states a factual expiry
 *   time and a total; it never counts down and never
 *   says "hurry".
 * - The buy guard here (disable on click, ignore a second
 *   in-flight click) is presentation only — the server
 *   consume-once rule is what prevents a second charge,
 *   and no approval button is ever rendered after
 *   approval (processing / completed / reconciliation /
 *   reapproval states render status or a new review,
 *   never a fresh Buy).
 *
 * RENDERING CONTRACT:
 * - mountMuseFeaturePanel(container, state, handlers)
 *   renders into the container and returns
 *   {update, unmount}. update(state) re-renders the
 *   content area in place: it replaces the content
 *   children, it never appends a second root, a second
 *   announcement region, or a second set of buttons, so
 *   re-rendering cannot duplicate nodes or listeners
 *   (detached nodes take their listeners with them).
 * - Focus: on resume the review prompt receives focus; a
 *   newly appearing warning or reapproval banner receives
 *   focus when it appears (not on every re-render, so
 *   focus is never stolen repeatedly). Approval is a
 *   native <button>, never a div with an onclick.
 * - Announced status: one dedicated region with an
 *   aria-live attribute — polite for ordinary status,
 *   assertive only for reapproval and reconciliation
 *   warnings. Status is never colour alone: every state
 *   is a word, and the timeline states each stage in
 *   words (done / in progress / not yet).
 */

/** A server-validated exact review, as the Muse host supplies it. */
export interface MuseFeatureReviewSheet {
  connectionId: string;
  draftId: string;
  /** Resolved seller display name — never a raw provider ID. */
  seller: string;
  items: Array<{label: string; quantity: number; unitPrice: string}>;
  shipTo: string;
  /** Shipping line, e.g. "Free shipping · 0.00 USD". */
  shipping: string;
  payment: 'Saved payment' | 'Shop Pay · Saved payment';
  terms: string;
  paymentTiming: string;
  estimatedArrival: string;
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
}

export interface MuseFeatureReviewDiffInput {
  total: string;
  currency: string;
  shippingAmount?: string;
  taxAmount?: string;
}

const rawIdPattern = /gid:\/\/|myshopify\.com|acct_/i;

function checkNoRawId(value: string): void {
  if (rawIdPattern.test(value)) throw new Error('muse_feature_panel_unsafe_display');
}

function money(amount: string, currency: string): string {
  return `$${amount} ${currency}`;
}

/**
 * The exact review as real text, in the fixed reading order
 * of docs/accessibility-abandoned-recovery.md §1.1:
 * seller -> item/configuration -> ship-to -> shipping ->
 * tax -> total (with the sum visible) -> payment timing ->
 * refund terms -> approval action labelled with the amount.
 */
export function renderMuseFeatureReviewText(sheet: MuseFeatureReviewSheet): string[] {
  checkNoRawId(sheet.seller);
  for (const item of sheet.items) checkNoRawId(item.label);
  checkNoRawId(sheet.shipTo);
  for (const value of [sheet.terms, sheet.paymentTiming, sheet.estimatedArrival]) checkNoRawId(value);
  if (sheet.payment !== 'Saved payment' && sheet.payment !== 'Shop Pay · Saved payment') {
    throw new Error('muse_feature_panel_unsafe_display');
  }
  // The sheet's shipping line is "title · amount currency";
  // the amount is extracted only to make the sum visible in
  // the total line (subtotal + shipping + tax = total),
  // never to invent a price. If the line carries no amount,
  // the total is shown alone rather than with a guessed sum.
  const shippingAmount = sheet.shipping.match(/([0-9]+(?:\.[0-9]+)?) [A-Z]{3}$/)?.[1];
  const totalLine = shippingAmount
    ? `Total: ${sheet.subtotal} ${sheet.currency} + ${shippingAmount} ${sheet.currency} + ${sheet.tax} ${sheet.currency} = ${sheet.total} ${sheet.currency}`
    : `Total: ${sheet.total} ${sheet.currency}`;
  return [
    `Seller: ${sheet.seller}`,
    ...sheet.items.map((item) => `Item: ${item.quantity} × ${item.label} · ${item.unitPrice} ${sheet.currency}`),
    `Ship to: ${sheet.shipTo}`,
    `Shipping: ${sheet.shipping}`,
    `Tax: ${sheet.tax} ${sheet.currency}`,
    totalLine,
    `Payment timing: ${sheet.paymentTiming}`,
    `Refund and cancellation terms: ${sheet.terms}`,
    `Estimated arrival: ${sheet.estimatedArrival}`,
    `Payment: ${sheet.payment}`,
    `Approve ${money(sheet.total, sheet.currency)}`,
  ];
}

/**
 * A reapproval diff in words. The old total is struck
 * through AND described: in text it is shown as ~~$old~~
 * alongside the sentence "It was $old, now it is $new";
 * the DOM renderer turns the marker into an <s> element
 * with the same sentence. Colour is never the only signal.
 * The sentence always states that the old approval no
 * longer applies and fresh approval is required.
 */
export function renderMuseFeatureReapprovalDiffText(args: {
  oldReview: MuseFeatureReviewDiffInput;
  newReview: MuseFeatureReviewDiffInput;
}): string[] {
  const lines: string[] = [];
  if (args.oldReview.total !== args.newReview.total || args.oldReview.currency !== args.newReview.currency) {
    lines.push(`Total: ~~${money(args.oldReview.total, args.oldReview.currency)}~~ ${money(args.newReview.total, args.newReview.currency)}`);
  }
  if (
    args.oldReview.shippingAmount !== undefined && args.newReview.shippingAmount !== undefined &&
    args.oldReview.shippingAmount !== args.newReview.shippingAmount
  ) {
    lines.push(`Shipping changed from ${money(args.oldReview.shippingAmount, args.oldReview.currency)} to ${money(args.newReview.shippingAmount, args.newReview.currency)}.`);
  }
  if (
    args.oldReview.taxAmount !== undefined && args.newReview.taxAmount !== undefined &&
    args.oldReview.taxAmount !== args.newReview.taxAmount
  ) {
    lines.push(`Tax changed from ${money(args.oldReview.taxAmount, args.oldReview.currency)} to ${money(args.newReview.taxAmount, args.newReview.currency)}.`);
  }
  if (lines.length === 0) return [];
  const totalLine = args.oldReview.total !== args.newReview.total || args.oldReview.currency !== args.newReview.currency
    ? `The total changed. It was ${money(args.oldReview.total, args.oldReview.currency)}, now it is ${money(args.newReview.total, args.newReview.currency)}.`
    : 'A term changed.';
  return [totalLine, ...lines, 'Your old approval no longer applies. Review the updated total and approve again.'];
}

/**
 * Announced status text: one plain-text sentence per state
 * transition, for screen readers, voice output, and any
 * status region. Colour alone is never the announcement.
 * Unknown states fail closed to a generic verified-status
 * sentence — they never invent a state, a date, or a
 * carrier. Tracking is "not available yet" when no
 * tracking exists; a date or carrier is never invented.
 * No accessibility standard is claimed — this is
 * announced text, not a compliance audit.
 */
export function announceMuseFeatureStatus(state: string): string {
  switch (state) {
    case 'approved':
      return 'Your purchase is approved. Payment is being verified.';
    case 'payment_verified':
    case 'PAYMENT_PROCESSING':
      return 'Payment is verified. Your order is being prepared.';
    case 'shipped':
      return 'Your order has shipped.';
    case 'delivered':
      return 'Your order has been delivered.';
    case 'ORDER_CREATED':
      return 'Your order is confirmed. Tracking is not available yet.';
    case 'tracking_available':
      return 'Your order is confirmed and tracking is available.';
    case 'RECONCILE_REQUIRED':
    case 'reconciliation':
    case 'reconciliation_required':
      return 'Your order needs reconciliation. No second charge will be made. You will be updated when it is resolved.';
    case 'reapproval_required':
      return 'The total changed. Your old approval no longer applies. Review the updated total and approve again.';
    case 'REFUND_REQUIRED':
      return 'A refund is required. It has not been submitted yet.';
    case 'REFUND_EXECUTING':
    case 'REFUND_PENDING':
      return 'Your refund is being processed. It is not verified refunded yet.';
    case 'REFUND_SUBMITTED':
      return 'Your refund has been submitted. It is not verified refunded yet.';
    case 'REFUNDED':
      return 'Your refund is verified refunded.';
    case 'PAYMENT_FALLBACK_PENDING':
    case 'authentication_required':
      return 'Payment authentication is required. Complete the trusted payment step to continue.';
    case 'processing':
    case 'resume':
    case 'IN_PROGRESS':
      return 'Your order is still processing. No new approval is needed and you will not be charged again.';
    case 'completed':
      return 'Your order is complete.';
    case 'failed':
      return 'That attempt did not complete. No charge was confirmed. You may try again from the review.';
    default:
      return 'Your order status has changed. Check your order status in Muse for the current verified status.';
  }
}

/**
 * Pre-expiry warning window: the final 2 minutes of a
 * draft's life. Drafts live 10 minutes in this codebase
 * (ProviderTransactionDraftService ttlMs = 10*60*1000), so
 * a 10-minute window would warn for the whole life of
 * every draft and would be useless as a warning.
 */
export const MUSE_FEATURE_DRAFT_EXPIRY_WARNING_MS = 2 * 60 * 1000;

export interface MuseFeatureDraftExpiryWarning {
  kind: 'expiry_warning';
  draftId: string;
  expiresAt: string;
  remainingMs: number;
  /** Factual text only: expiry time, exact total, and that approval must be re-done after expiry. No "hurry", no countdown, no pressure. */
  text: string;
}

/**
 * Returns a warning when expiry is near (remaining > 0 and
 * <= the warning window), and null otherwise — expired, or
 * comfortably unexpired, both return null, so a warning is
 * never shown for a draft that is already dead or in no
 * danger. The text states the exact total and that expiry
 * means re-review and fresh approval, never a lost order
 * and never an automatic charge.
 */
export function museFeatureDraftExpiryWarning(args: {
  draftId: string;
  expiresAt: string;
  total: string;
  currency: string;
  now: string;
}): MuseFeatureDraftExpiryWarning | null {
  const expiry = Date.parse(args.expiresAt);
  const at = Date.parse(args.now);
  if (!Number.isFinite(expiry) || !Number.isFinite(at)) return null;
  const remainingMs = expiry - at;
  if (remainingMs <= 0 || remainingMs > MUSE_FEATURE_DRAFT_EXPIRY_WARNING_MS) return null;
  return {
    kind: 'expiry_warning',
    draftId: args.draftId,
    expiresAt: args.expiresAt,
    remainingMs,
    text: `Your review for $${args.total} ${args.currency} expires at ${args.expiresAt}. If it expires, you will need to review the updated total and approve again. Nothing will be charged automatically.`,
  };
}

// ---------------------------------------------------------------------------
// DOM panel
// ---------------------------------------------------------------------------

export type MuseFeaturePanelView = 'review' | 'resume' | 'reapproval' | 'status';

export type MuseFeatureReminderChoice = 'undecided' | 'opted_in' | 'opted_out';

export interface MuseFeaturePanelState {
  view: MuseFeaturePanelView;
  /** Server-validated review sheet; null only for a status view that carries no review. */
  sheet: MuseFeatureReviewSheet | null;
  /** Previous review, for the reapproval diff. Required when view is 'reapproval'. */
  previousReview?: MuseFeatureReviewDiffInput;
  /** Execution state for the status view / timeline (see announceMuseFeatureStatus states). */
  executionState?: string;
  /** Tracking text when available; null/undefined means "not available yet", never invented. */
  tracking?: string | null;
  /** Draft expiry for the pre-expiry banner; banner shows only inside the warning window. */
  expiry?: {expiresAt: string; total: string; currency: string; now: string} | null;
  /** Reminder choice at review stage; default 'undecided' (OFF). */
  reminder?: MuseFeatureReminderChoice;
  /** Explicit announcement override; otherwise computed from the view/execution state. */
  announcement?: string;
}

export interface MuseFeaturePanelHandlers {
  /** Approval handler (host: server re-validates and consumes once). Called at most once per in-flight click. */
  onApprove?: () => Promise<void> | void;
  /** Resume handler: the host revalidates the owned draft first, then calls update() with the review or reapproval state. */
  onResume?: () => Promise<void> | void;
  /** Reminder opt-in handler: the host calls optInToReminder with the authenticated principal only. */
  onReminderOptIn?: () => Promise<void> | void;
  /** Reminder dismiss/opt-out handler for a pending reminder. */
  onReminderOptOut?: () => void;
}

export interface MuseFeaturePanelMount {
  update(state: MuseFeaturePanelState): void;
  unmount(): void;
  root: Element;
}

function el(doc: Document, tag: string, text?: string): HTMLElement {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const TIMELINE: Array<{key: string; label: string}> = [
  {key: 'approved', label: 'Approved'},
  {key: 'payment_verified', label: 'Payment verified'},
  {key: 'shipped', label: 'Shipped'},
  {key: 'delivered', label: 'Delivered'},
];

/**
 * Timeline position for an execution state: [doneCount, currentIndex].
 * currentIndex null means no stage is "in progress" (the order is
 * confirmed and awaiting shipment, or the state is not an order
 * stage at all) — the done stages are still stated in words.
 */
function timelinePosition(executionState: string | undefined): [number, number | null] {
  switch (executionState) {
    case 'approved': return [0, 0];
    case 'payment_verified':
    case 'PAYMENT_PROCESSING':
    case 'processing':
    case 'resume':
    case 'IN_PROGRESS': return [1, 1];
    case 'ORDER_CREATED':
    case 'completed': return [2, null];
    case 'shipped': return [2, 2];
    case 'delivered': return [3, 3];
    case 'RECONCILE_REQUIRED':
    case 'reconciliation':
    case 'reconciliation_required': return [1, 1];
    case 'REFUND_REQUIRED':
    case 'REFUND_EXECUTING':
    case 'REFUND_PENDING':
    case 'REFUND_SUBMITTED':
    case 'REFUNDED': return [2, null];
    case 'PAYMENT_FALLBACK_PENDING':
    case 'authentication_required': return [1, 1];
    default: return [0, 0];
  }
}

function announcementFor(state: MuseFeaturePanelState): {text: string; assertive: boolean} {
  if (state.announcement !== undefined) return {text: state.announcement, assertive: false};
  switch (state.view) {
    case 'resume':
      return {text: 'Your review is waiting in Muse.', assertive: false};
    case 'reapproval':
      return {text: announceMuseFeatureStatus('reapproval_required'), assertive: true};
    case 'status': {
      const text = announceMuseFeatureStatus(state.executionState ?? 'processing');
      const assertive = state.executionState === 'RECONCILE_REQUIRED' || state.executionState === 'reconciliation' || state.executionState === 'reconciliation_required';
      return {text, assertive};
    }
    default:
      return {text: '', assertive: false};
  }
}

export function mountMuseFeaturePanel(
  container: Element,
  initialState: MuseFeaturePanelState,
  handlers: MuseFeaturePanelHandlers,
): MuseFeaturePanelMount {
  const doc = (container.ownerDocument ?? document) as Document;
  // Buy guard, presentation layer only: one in-flight approval
  // at a time. The server consume-once rule remains the real
  // protection against a second charge.
  let submitting = false;
  let previousView: MuseFeaturePanelView | null = null;
  let warningWasPresent = false;

  clear(container);
  const root = el(doc, 'section');
  root.setAttribute('class', 'muse-feature-panel');
  const announcement = el(doc, 'p');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.setAttribute('class', 'muse-feature-announcement');
  const content = el(doc, 'div');
  content.setAttribute('class', 'muse-feature-content');
  root.appendChild(announcement);
  root.appendChild(content);
  container.appendChild(root);

  function focus(node: HTMLElement): void {
    if (typeof node.focus === 'function') node.focus();
  }

  function approvalButton(sheet: MuseFeatureReviewSheet): HTMLButtonElement {
    const button = doc.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('data-muse-review-approve', '');
    button.setAttribute('data-draft-id', sheet.draftId);
    button.textContent = `Approve $${sheet.total} ${sheet.currency}`;
    button.disabled = submitting;
    button.addEventListener('click', () => {
      if (submitting || button.disabled) return;
      submitting = true;
      button.disabled = true;
      button.textContent = 'Processing…';
      let result: unknown;
      try {
        result = handlers.onApprove?.();
      } catch {
        submitting = false;
        button.disabled = false;
        button.textContent = `Approve $${sheet.total} ${sheet.currency}`;
        announcement.textContent = 'That attempt did not complete. No charge was confirmed. You may try again from the review.';
        return;
      }
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).then(
          () => { /* stays disabled: the host moves the state forward via update() */ },
          () => {
            submitting = false;
            button.disabled = false;
            button.textContent = `Approve $${sheet.total} ${sheet.currency}`;
            announcement.textContent = 'That attempt did not complete. No charge was confirmed. You may try again from the review.';
          },
        );
      }
    });
    return button;
  }

  function reminderSection(state: MuseFeaturePanelState): HTMLElement {
    const section = el(doc, 'div');
    section.setAttribute('class', 'muse-feature-reminder');
    const choice = state.reminder ?? 'undecided';
    const label = el(doc, 'label');
    const checkbox = doc.createElement('input');
    checkbox.setAttribute('type', 'checkbox');
    checkbox.setAttribute('data-muse-reminder-opt-in', '');
    // Default OFF, never pre-checked: checked follows the
    // host-owned state only, and rendering never opts in.
    checkbox.checked = choice === 'opted_in';
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) void handlers.onReminderOptIn?.();
      else handlers.onReminderOptOut?.();
    });
    label.appendChild(checkbox);
    label.appendChild(doc.createTextNode(' Remind me about this review'));
    section.appendChild(label);
    section.appendChild(el(doc, 'p', 'One reminder only. It will not include a price.'));
    if (choice === 'opted_in') {
      const dismiss = doc.createElement('button');
      dismiss.setAttribute('type', 'button');
      dismiss.setAttribute('data-muse-reminder-dismiss', '');
      dismiss.textContent = 'Dismiss reminder';
      dismiss.addEventListener('click', () => { handlers.onReminderOptOut?.(); });
      section.appendChild(dismiss);
    }
    return section;
  }

  function reviewSection(sheet: MuseFeatureReviewSheet): HTMLElement {
    const section = el(doc, 'section');
    section.setAttribute('class', 'muse-feature-exact-review');
    section.setAttribute('data-draft-id', sheet.draftId);
    section.setAttribute('tabindex', '-1');
    // renderMuseFeatureReviewText throws on raw IDs and
    // returns lines in reading order; the last line is the
    // approval label, rendered as a native button below,
    // not as text.
    const lines = renderMuseFeatureReviewText(sheet);
    const body = lines.slice(0, -1);
    for (const line of body) section.appendChild(el(doc, 'p', line));
    section.appendChild(approvalButton(sheet));
    return section;
  }

  function reapprovalBanner(state: MuseFeaturePanelState): HTMLElement | null {
    if (!state.previousReview || !state.sheet) return null;
    // The sheet's shipping line is "title · amount currency";
    // the amount is extracted only so a shipping change is
    // stated in the diff, never to invent a price.
    const shippingAmount = state.sheet.shipping.match(/([0-9]+(?:\.[0-9]+)?) [A-Z]{3}$/)?.[1];
    const lines = renderMuseFeatureReapprovalDiffText({
      oldReview: state.previousReview,
      newReview: {total: state.sheet.total, currency: state.sheet.currency, shippingAmount, taxAmount: state.sheet.tax},
    });
    if (lines.length === 0) return null;
    const banner = el(doc, 'section');
    banner.setAttribute('class', 'muse-feature-reapproval');
    banner.setAttribute('role', 'status');
    banner.setAttribute('tabindex', '-1');
    const [sentence, ...rest] = lines;
    banner.appendChild(el(doc, 'p', sentence));
    for (const line of rest) {
      const paragraph = el(doc, 'p');
      // The ~~old total~~ marker becomes a struck-through
      // element AND stays described in words (the sentence
      // above names the old and new totals in full).
      const match = line.match(/~~([^~]+)~~/);
      if (match) {
        paragraph.appendChild(doc.createTextNode(line.slice(0, match.index ?? 0)));
        const struck = doc.createElement('s');
        struck.textContent = match[1];
        paragraph.appendChild(struck);
        paragraph.appendChild(doc.createTextNode(line.slice((match.index ?? 0) + match[0].length)));
      } else {
        paragraph.textContent = line;
      }
      banner.appendChild(paragraph);
    }
    return banner;
  }

  function warningBanner(state: MuseFeaturePanelState): HTMLElement | null {
    if (!state.expiry) return null;
    const warning = museFeatureDraftExpiryWarning({
      draftId: state.sheet?.draftId ?? '',
      expiresAt: state.expiry.expiresAt,
      total: state.expiry.total,
      currency: state.expiry.currency,
      now: state.expiry.now,
    });
    if (!warning) return null;
    const banner = el(doc, 'div');
    banner.setAttribute('class', 'muse-feature-expiry-warning');
    banner.setAttribute('tabindex', '-1');
    banner.textContent = warning.text;
    return banner;
  }

  function statusSection(state: MuseFeaturePanelState): HTMLElement {
    const section = el(doc, 'section');
    section.setAttribute('class', 'muse-feature-status');
    section.setAttribute('tabindex', '-1');
    const [doneCount, currentIndex] = timelinePosition(state.executionState);
    const list = doc.createElement('ol');
    list.setAttribute('class', 'muse-feature-timeline');
    TIMELINE.forEach((stage, index) => {
      const item = el(doc, 'li');
      const stageState = index < doneCount ? 'done' : index === currentIndex ? 'in progress' : 'not yet';
      item.textContent = `${stage.label} — ${stageState}`;
      list.appendChild(item);
    });
    section.appendChild(list);
    if (state.executionState === 'ORDER_CREATED' || state.executionState === 'completed') {
      section.appendChild(el(doc, 'p', state.tracking ? `Tracking: ${state.tracking}` : 'Tracking is not available yet.'));
    } else if (state.executionState === 'RECONCILE_REQUIRED' || state.executionState === 'reconciliation' || state.executionState === 'reconciliation_required') {
      section.appendChild(el(doc, 'p', 'No second charge will be made. You will be updated when it is resolved.'));
    }
    // No approval button is ever rendered in a status view:
    // processing, completed, reconciliation, and reapproval
    // states never offer a fresh Buy.
    return section;
  }

  function render(state: MuseFeaturePanelState): void {
    const {text, assertive} = announcementFor(state);
    announcement.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    announcement.textContent = text;

    clear(content);
    let focusTarget: HTMLElement | null = null;
    const warning = warningBanner(state);
    if (warning) {
      content.appendChild(warning);
      if (!warningWasPresent) focusTarget = warning;
    }
    warningWasPresent = warning !== null;

    if (state.view === 'resume') {
      const prompt = el(doc, 'section');
      prompt.setAttribute('class', 'muse-feature-resume');
      prompt.setAttribute('tabindex', '-1');
      prompt.appendChild(el(doc, 'p', 'Your review is waiting in Muse.'));
      const button = doc.createElement('button');
      button.setAttribute('type', 'button');
      button.setAttribute('data-muse-resume', '');
      button.textContent = 'Return to review';
      button.addEventListener('click', () => { void handlers.onResume?.(); });
      prompt.appendChild(button);
      content.appendChild(prompt);
      focusTarget = prompt;
      // Deliberately no review here, even if a sheet is
      // supplied: the review is shown only after the host's
      // resume handler revalidates the draft and calls
      // update() with the review or reapproval state.
    } else if (state.view === 'reapproval') {
      const banner = reapprovalBanner(state);
      if (banner) {
        content.appendChild(banner);
        if (previousView !== 'reapproval') focusTarget = banner;
      }
      if (state.sheet) content.appendChild(reviewSection(state.sheet));
    } else if (state.view === 'status') {
      content.appendChild(statusSection(state));
    } else if (state.sheet) {
      content.appendChild(reviewSection(state.sheet));
    }

    // Reminder opt-in is a review-stage choice only: it is
    // rendered for review and reapproval views, never for a
    // status view, and never pre-checked (see reminderSection).
    if ((state.view === 'review' || state.view === 'reapproval') && state.sheet) {
      content.appendChild(reminderSection(state));
    }

    previousView = state.view;
    if (focusTarget) focus(focusTarget);
  }

  render(initialState);

  return {
    update(state: MuseFeaturePanelState): void {
      render(state);
    },
    unmount(): void {
      clear(container);
    },
    root,
  };
}
