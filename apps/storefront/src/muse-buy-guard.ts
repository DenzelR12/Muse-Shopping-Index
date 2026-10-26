/**
 * One-click Buy guard for the Muse confirmation surface.
 *
 * This guard is for the HTML produced by renderMuseConfirmation()
 * (a button with `data-muse-buy`). The storefront's main page is a
 * separate gifting-concierge surface and does not render that button,
 * so pages that do render a Muse confirmation must call
 * attachMuseBuyGuard() with their own submit/status handlers.
 *
 * Behaviour, independent of the server (which remains the backstop):
 * - The button is disabled immediately on the first click, before any
 *   network work, and its label shows progress. A second click while
 *   a submission is in flight is ignored, never submitted twice.
 * - Progress is preserved: after a successful submit the button stays
 *   disabled with a "Checking status…" label until the owned status
 *   resolves; it is not re-enabled to allow a duplicate Buy.
 * - On reconnect, resume() re-reads owned status by draft ID. If the
 *   transaction is still processing, in authentication fallback, in
 *   reconciliation, or already completed, no new approval is required
 *   and no new submission is made. Only drift or expiry requires a
 *   fresh approval, in which case the button is re-enabled with
 *   "Buy now" and the in-flight flag is cleared.
 * - Server consume-once approval, draft-hash revalidation, and
 *   provider idempotency remain the authoritative duplicate
 *   protection; this guard is UX only and never grants approval.
 */

export type OwnedBuyStatus = {
  state: string;
  drift?: boolean;
  expired?: boolean;
};

export type BuyResumeDecision = {
  action: 'resume' | 'completed' | 'reconciliation' | 'reapproval_required';
  requiresNewApproval: boolean;
};

export function decideBuyResume(status: OwnedBuyStatus): BuyResumeDecision {
  if (status.drift === true || status.expired === true) {
    return { action: 'reapproval_required', requiresNewApproval: true };
  }
  switch (status.state) {
    case 'ORDER_CREATED':
    case 'REFUNDED':
      return { action: 'completed', requiresNewApproval: false };
    case 'RECONCILE_REQUIRED':
      return { action: 'reconciliation', requiresNewApproval: false };
    case 'CHECKOUT_CREATED':
    case 'PAYMENT_FALLBACK_PENDING':
    case 'PAYMENT_PROCESSING':
    case 'IN_PROGRESS':
    case 'REFUND_PENDING':
    case 'REFUND_SUBMITTED':
      return { action: 'resume', requiresNewApproval: false };
    default:
      // Unknown status: fail closed. Do not retry blindly and do not
      // assume a new approval is safe; require a fresh review.
      return { action: 'reapproval_required', requiresNewApproval: true };
  }
}

export interface MuseBuyButtonLike {
  disabled: boolean;
  textContent: string | null;
  dataset: Record<string, string | undefined>;
  addEventListener?: (type: string, listener: () => void) => void;
}

export interface MuseBuyGuardHandlers {
  submit: () => Promise<void>;
  readOwnedStatus: (draftId: string) => Promise<OwnedBuyStatus>;
  onStatus?: (status: string) => void;
}

export class MuseBuyGuard {
  private inFlight = false;
  private readonly button: MuseBuyButtonLike;
  private readonly handlers: MuseBuyGuardHandlers;
  readonly draftId: string;

  constructor(button: MuseBuyButtonLike, handlers: MuseBuyGuardHandlers) {
    if (!button.dataset.draftId) throw new Error('muse_buy_guard_draft_required');
    this.button = button;
    this.handlers = handlers;
    this.draftId = button.dataset.draftId;
  }

  get isInFlight(): boolean {
    return this.inFlight;
  }

  /** Attempt a Buy click. Returns false without submitting if already in flight. */
  async click(): Promise<{ accepted: boolean; reason?: string }> {
    if (this.inFlight) return { accepted: false, reason: 'already_submitting' };
    this.inFlight = true;
    this.button.disabled = true;
    this.button.textContent = 'Processing…';
    this.handlers.onStatus?.('submitting');
    try {
      await this.handlers.submit();
    } catch (error) {
      // Submission failed before any authoritative effect was confirmed:
      // allow a retry with a fresh click, but never auto-retry here.
      this.inFlight = false;
      this.button.disabled = false;
      this.button.textContent = 'Buy now';
      this.handlers.onStatus?.('failed');
      throw error;
    }
    // Success means the server accepted the submission; progress is
    // preserved and the button stays disabled until resume() resolves
    // the owned status. It is not re-enabled here.
    this.button.textContent = 'Checking status…';
    this.handlers.onStatus?.('processing');
    return { accepted: true };
  }

  /**
   * Reconnect / resume: re-read owned status by draft ID and decide
   * without a new submission. Returns the decision; callers that
   * receive 'reapproval_required' must present a fresh review before
   * any new Buy is accepted.
   */
  async resume(): Promise<BuyResumeDecision> {
    const status = await this.handlers.readOwnedStatus(this.draftId);
    const decision = decideBuyResume(status);
    if (decision.action === 'reapproval_required') {
      this.inFlight = false;
      this.button.disabled = false;
      this.button.textContent = 'Buy now';
      this.handlers.onStatus?.('reapproval_required');
    } else if (decision.action === 'completed') {
      this.inFlight = false;
      this.button.disabled = true;
      this.button.textContent = 'Done';
      this.handlers.onStatus?.('completed');
    } else {
      // resume / reconciliation: stay disabled, show progress, do not
      // submit again and do not require a new approval.
      this.inFlight = false;
      this.button.disabled = true;
      this.button.textContent =
        decision.action === 'reconciliation' ? 'Reconciling…' : 'Checking status…';
      this.handlers.onStatus?.(decision.action);
    }
    return decision;
  }
}

export interface MuseBuyRootLike {
  querySelectorAll: (selector: string) => Iterable<MuseBuyButtonLike>;
}

export function attachMuseBuyGuard(
  root: MuseBuyRootLike,
  handlers: MuseBuyGuardHandlers
): MuseBuyGuard[] {
  const guards: MuseBuyGuard[] = [];
  for (const button of root.querySelectorAll('[data-muse-buy]')) {
    const guard = new MuseBuyGuard(button, handlers);
    guards.push(guard);
    if (button.addEventListener) {
      button.addEventListener('click', () => {
        // Fire-and-forget by design: click() itself guards in-flight
        // duplicates, and a rejected submit re-enables the button.
        void guard.click().catch(() => {});
      });
    }
  }
  return guards;
}
