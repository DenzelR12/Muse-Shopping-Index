/**
 * Abandoned-chat recovery, in code — Muse Shopping Index.
 *
 * This implements docs/accessibility-abandoned-recovery.md §2 (resume
 * by draft) and §1.4 (pre-expiry warning) as deterministic server code.
 * It is NOT a live recovery claim, NOT an accessibility-standard claim,
 * and NOT a new public route: like muse-reminder.ts and
 * meta-catalog.ts, this is an internal helper. A future route must
 * pass the authenticated principal, or it must not exist.
 *
 * WHY THERE IS NO DRAFT-LISTING STORE HERE: the signed-draft
 * authority (PostgresZeroTrustAuthority / DraftAuthority) exposes
 * get(draftId) and save(), not a list-by-consumer query, and the
 * transaction-intent store exposes getForConsumer(subject, draftId),
 * not a list either. Inventing a "list every draft for this consumer"
 * query over the signed-envelope table would be a new tenant-scoped
 * surface that this change does not need: re-entry in production
 * already knows the draft it is returning to (the host request
 * carries draftId, and the confirmation page carries draftId), and
 * what was missing was the *decision* for that draft — present the
 * review, revalidate it, or show its execution state — plus the
 * fail-closed tenant checks around it. That decision is what this
 * module provides. A caller that does hold a server-owned list of a
 * consumer's drafts (for example from transaction intents) can use
 * findOwnedResumeDraft() to filter it; that helper never returns a
 * draft belonging to another consumer or company, it only ignores
 * such rows, because the list itself is server-owned, not a claim.
 *
 * RULES, ENFORCED IN CODE (not just in docs):
 *
 * 1. IDENTITY COMES FROM THE AUTHENTICATED PRINCIPAL ONLY.
 *    principalSubject / principalCompanyId are server-resolved.
 *    They are never read from a request body, a caption, or model
 *    text. companyId must equal principalCompanyId (else
 *    provider_readiness_company_mismatch); consumerSubject must
 *    equal principalSubject (else consumer_agent_not_found, the
 *    host's existing owned() error).
 *
 * 2. RESUME NEVER RESTARTS, NEVER RE-BUYS, NEVER RE-EXECUTES.
 *    - Unapproved + unexpired + unchanged -> present_review.
 *      Returning to the review is NOT approval.
 *    - Expired or changed -> reapproval_required. The old review
 *      is never carried over and no old approval is carried over.
 *      revalidateAndResume() may then build a NEW draft through
 *      the caller's existing draft/revalidation path (mocked in
 *      tests); if revalidation supplies nothing, the result is
 *      revalidation_failed and no review is shown.
 *    - Already approved / execution recorded -> execution_state
 *      (processing, completed, reconciliation, or authentication
 *      required). It never offers a fresh Buy, never submits
 *      again, and never charges a second time.
 *
 * 3. PRE-EXPIRY WARNING IS FACTUAL, NEVER PRESSURE. Drafts in
 *    this codebase live 10 minutes (ProviderTransactionDraftService
 *    ttlMs = 10*60*1000). A "last 10 minutes" warning window would
 *    warn for the whole life of every draft, so the window here
 *    is the final 2 minutes (MUSE_DRAFT_EXPIRY_WARNING_MS).
 *    The warning text states the expiry time and the exact total
 *    and that approval must be re-done after expiry. It never
 *    says "hurry", never counts down, and never implies a
 *    discount or a loss beyond re-approval.
 *
 * 4. REMINDER RETENTION. An expired draft's reminder record is
 *    dead: it can never send (muse-reminder.ts already refuses
 *    expired drafts at send time). purgeEligibleReminderRecords()
 *    is the pure eligibility check — it returns the dead records
 *    for the caller to delete. No scheduler / cron is added here;
 *    deletion itself is a separate operational step.
 */

export type MuseResumeExecutionState =
  | 'processing'
  | 'completed'
  | 'reconciliation'
  | 'authentication_required';

export interface MuseResumeDraftSnapshot {
  draftId: string;
  companyId: string;
  consumerSubject: string;
  connectionId: string;
  /** ISO expiry of the draft. Unparseable or past expiry = expired. */
  expiresAt: string;
  /** Total as a decimal string, exactly as on the signed draft (e.g. '277'). */
  total: string;
  currency: string;
  /** Shipping amount as a decimal string, when known. */
  shippingAmount?: string;
  /** Tax amount as a decimal string, when known. */
  taxAmount?: string;
  /** True when live revalidation found price/tax/shipping/configuration changed since review. */
  changedSinceReview: boolean;
  /** True when an explicit approval already exists for this draft. */
  approved: boolean;
  /** Execution state when one is recorded; absent means no execution yet. */
  executionState?: MuseResumeExecutionState;
}

export interface MuseResumePrincipal {
  subject: string;
  companyId: string;
}

export type MuseResumeDecision =
  | {
      kind: 'present_review';
      draftId: string;
      /** Returning to the review is not approval: approval is still required, explicitly. */
      approvalRequired: true;
      approvalCarried: false;
      executeAgain: false;
      freshBuy: false;
    }
  | {
      kind: 'reapproval_required';
      draftId: string;
      reason: 'expired' | 'changed';
      requiresNewApproval: true;
      approvalCarried: false;
      executeAgain: false;
      freshBuy: false;
    }
  | {
      kind: 'execution_state';
      draftId: string;
      executionState: MuseResumeExecutionState;
      requiresNewApproval: false;
      executeAgain: false;
      freshBuy: false;
    };

export type MuseRevalidatedResume =
  | MuseResumeDecision
  | {
      kind: 'revalidated_review';
      oldDraftId: string;
      newDraft: MuseResumeDraftSnapshot;
      diff: MuseReviewDiff;
      requiresNewApproval: true;
      approvalCarried: false;
      executeAgain: false;
      freshBuy: false;
    }
  | {
      kind: 'revalidation_failed';
      oldDraftId: string;
      reason: 'no_new_draft';
      requiresNewApproval: false;
      approvalCarried: false;
      executeAgain: false;
      freshBuy: false;
    };

function requireNonEmpty(value: unknown, error: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(error);
  return value;
}

export function isDraftExpired(expiresAt: string, now: string): boolean {
  const expiry = Date.parse(expiresAt);
  const at = Date.parse(now);
  return !Number.isFinite(expiry) || !Number.isFinite(at) || expiry <= at;
}

function checkTenant(
  principal: MuseResumePrincipal,
  draft: Pick<MuseResumeDraftSnapshot, 'companyId' | 'consumerSubject'>,
): void {
  requireNonEmpty(principal.subject, 'muse_resume_subject_required');
  requireNonEmpty(principal.companyId, 'muse_resume_company_required');
  if (draft.companyId !== principal.companyId) throw new Error('provider_readiness_company_mismatch');
  if (draft.consumerSubject !== principal.subject) throw new Error('consumer_agent_not_found');
}

/**
 * The resume decision for one server-owned draft, for one
 * authenticated consumer. Pure: it makes no network call and
 * never revalidates on its own — revalidation is the caller's
 * job (see revalidateAndResume), so a stale draft can never
 * be shown as current by this function alone.
 */
export function resumeDraftDecision(args: {
  principal: MuseResumePrincipal;
  draft: MuseResumeDraftSnapshot;
  now: string;
}): MuseResumeDecision {
  const {principal, draft} = args;
  requireNonEmpty(draft.draftId, 'muse_resume_draft_required');
  checkTenant(principal, draft);
  if (draft.approved || draft.executionState !== undefined) {
    return {
      kind: 'execution_state',
      draftId: draft.draftId,
      executionState: draft.executionState ?? 'processing',
      requiresNewApproval: false,
      executeAgain: false,
      freshBuy: false,
    };
  }
  if (isDraftExpired(draft.expiresAt, args.now)) {
    return {
      kind: 'reapproval_required',
      draftId: draft.draftId,
      reason: 'expired',
      requiresNewApproval: true,
      approvalCarried: false,
      executeAgain: false,
      freshBuy: false,
    };
  }
  if (draft.changedSinceReview) {
    return {
      kind: 'reapproval_required',
      draftId: draft.draftId,
      reason: 'changed',
      requiresNewApproval: true,
      approvalCarried: false,
      executeAgain: false,
      freshBuy: false,
    };
  }
  return {
    kind: 'present_review',
    draftId: draft.draftId,
    approvalRequired: true,
    approvalCarried: false,
    executeAgain: false,
    freshBuy: false,
  };
}

export interface MuseReviewDiff {
  changed: boolean;
  /** Plain-text lines, one per changed field, in words, not colour. */
  lines: string[];
  /** Full diff sentence, suitable for announcement and for the review. */
  text: string;
}

function money(amount: string, currency: string): string {
  return `$${amount} ${currency}`;
}

/**
 * Diff between an old review and a revalidated new review, in
 * words. The old total is never silently replaced: it is named
 * as the old value, and the sentence states plainly that the
 * old approval no longer applies and fresh approval is required.
 * Unchanged fields produce no line; an unchanged review has
 * changed === false and an empty text.
 */
export function buildReviewDiff(args: {
  oldDraft: Pick<MuseResumeDraftSnapshot, 'total' | 'currency' | 'shippingAmount' | 'taxAmount'>;
  newDraft: Pick<MuseResumeDraftSnapshot, 'total' | 'currency' | 'shippingAmount' | 'taxAmount'>;
}): MuseReviewDiff {
  const lines: string[] = [];
  const {oldDraft, newDraft} = args;
  if (oldDraft.total !== newDraft.total || oldDraft.currency !== newDraft.currency) {
    lines.push(`Total changed from ${money(oldDraft.total, oldDraft.currency)} to ${money(newDraft.total, newDraft.currency)}.`);
  }
  if (oldDraft.shippingAmount !== undefined && newDraft.shippingAmount !== undefined && oldDraft.shippingAmount !== newDraft.shippingAmount) {
    lines.push(`Shipping changed from ${money(oldDraft.shippingAmount, oldDraft.currency)} to ${money(newDraft.shippingAmount, newDraft.currency)}.`);
  }
  if (oldDraft.taxAmount !== undefined && newDraft.taxAmount !== undefined && oldDraft.taxAmount !== newDraft.taxAmount) {
    lines.push(`Tax changed from ${money(oldDraft.taxAmount, oldDraft.currency)} to ${money(newDraft.taxAmount, newDraft.currency)}.`);
  }
  if (lines.length === 0) return {changed: false, lines: [], text: ''};
  return {
    changed: true,
    lines,
    text: `The total changed. ${lines.join(' ')} Your old approval no longer applies. Review the updated total and approve again.`,
  };
}

/**
 * Revalidate-then-resume. The revalidate callback is the caller's
 * existing draft/revalidation path (mocked in tests); it is
 * invoked ONLY when the decision is reapproval_required, so a
 * present_review or execution_state result never triggers a
 * rebuild, and a failed revalidation never shows a review.
 * The new draft is tenant-checked and expiry-checked before
 * it is returned: a new draft that is itself expired, or that
 * belongs to another consumer/company, yields
 * revalidation_failed, never a review.
 */
export async function revalidateAndResume(args: {
  principal: MuseResumePrincipal;
  draft: MuseResumeDraftSnapshot;
  now: string;
  revalidate: (oldDraft: MuseResumeDraftSnapshot) => Promise<MuseResumeDraftSnapshot | null>;
}): Promise<MuseRevalidatedResume> {
  const decision = resumeDraftDecision({principal: args.principal, draft: args.draft, now: args.now});
  if (decision.kind !== 'reapproval_required') return decision;
  const newDraft = await args.revalidate(args.draft);
  if (!newDraft) {
    return {kind: 'revalidation_failed', oldDraftId: args.draft.draftId, reason: 'no_new_draft', requiresNewApproval: false, approvalCarried: false, executeAgain: false, freshBuy: false};
  }
  try {
    checkTenant(args.principal, newDraft);
  } catch {
    return {kind: 'revalidation_failed', oldDraftId: args.draft.draftId, reason: 'no_new_draft', requiresNewApproval: false, approvalCarried: false, executeAgain: false, freshBuy: false};
  }
  if (newDraft.approved || newDraft.executionState !== undefined || isDraftExpired(newDraft.expiresAt, args.now)) {
    return {kind: 'revalidation_failed', oldDraftId: args.draft.draftId, reason: 'no_new_draft', requiresNewApproval: false, approvalCarried: false, executeAgain: false, freshBuy: false};
  }
  return {
    kind: 'revalidated_review',
    oldDraftId: args.draft.draftId,
    newDraft,
    diff: buildReviewDiff({oldDraft: args.draft, newDraft}),
    requiresNewApproval: true,
    approvalCarried: false,
    executeAgain: false,
    freshBuy: false,
  };
}

/**
 * Filter a SERVER-OWNED list of drafts to the one draft this
 * authenticated consumer may resume. Rows belonging to another
 * consumer or company are ignored, never returned and never
 * revealed: filtering is the tenant boundary here, not an
 * error, because the list itself was not supplied by the
 * caller. Returns null when the consumer has no owned draft
 * in the list — that is "nothing to resume", not an error,
 * and the caller must then start a new flow, not invent one.
 * The returned draft is the first owned draft in list order;
 * callers that hold several owned drafts must order the list
 * (most recent first) before calling this.
 */
export function findOwnedResumeDraft(args: {
  principal: MuseResumePrincipal;
  drafts: MuseResumeDraftSnapshot[];
}): MuseResumeDraftSnapshot | null {
  for (const draft of args.drafts) {
    if (draft.companyId === args.principal.companyId && draft.consumerSubject === args.principal.subject) {
      return draft;
    }
  }
  return null;
}

/**
 * Pre-expiry warning window: the final 2 minutes of a draft's
 * life. Drafts live 10 minutes in this codebase
 * (ProviderTransactionDraftService ttlMs = 10*60*1000), so a
 * 10-minute window would warn for the whole life of every
 * draft and would be useless as a warning. 2 minutes is long
 * enough to read the review and approve, and short enough to
 * mean "expiry is near" rather than "a draft exists".
 */
export const MUSE_DRAFT_EXPIRY_WARNING_MS = 2 * 60 * 1000;

export interface MuseDraftExpiryWarning {
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
export function draftExpiryWarning(args: {
  draft: Pick<MuseResumeDraftSnapshot, 'draftId' | 'expiresAt' | 'total' | 'currency'>;
  now: string;
}): MuseDraftExpiryWarning | null {
  const expiry = Date.parse(args.draft.expiresAt);
  const at = Date.parse(args.now);
  if (!Number.isFinite(expiry) || !Number.isFinite(at)) return null;
  const remainingMs = expiry - at;
  if (remainingMs <= 0 || remainingMs > MUSE_DRAFT_EXPIRY_WARNING_MS) return null;
  return {
    kind: 'expiry_warning',
    draftId: args.draft.draftId,
    expiresAt: args.draft.expiresAt,
    remainingMs,
    text: `Your review for ${money(args.draft.total, args.draft.currency)} expires at ${args.draft.expiresAt}. If it expires, you will need to review the updated total and approve again. Nothing will be charged automatically.`,
  };
}

/**
 * Reminder-retention eligibility, pure. A reminder record is
 * dead exactly when its draft has expired: it can never send
 * (muse-reminder.ts refuses expired drafts at send time), so
 * it is eligible for deletion. This function only selects the
 * dead records; it deletes nothing and schedules nothing.
 * No retention job is added by this change.
 */
export function purgeEligibleReminderRecords<T extends {draftExpiresAt: string}>(args: {
  records: T[];
  now: string;
}): T[] {
  return args.records.filter((record) => isDraftExpired(record.draftExpiresAt, args.now));
}
