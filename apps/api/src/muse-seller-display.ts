/**
 * Server-owned seller display-name and item-title resolution for Muse reviews.
 *
 * Rules, enforced everywhere this module is used:
 * - A display name is never derived from a raw shop domain, a raw provider
 *   account ID, or a variant ID. Those values are only used as a rejection
 *   comparison: if a candidate equals one, or looks like one, it is rejected.
 * - A display name must come from a server-owned source: the signed draft
 *   state (created by an authenticated company caller), or a company
 *   connector manifest registered with the server. It must never come from
 *   model output, Reel metadata, or browser-submitted JSON.
 * - An item title must come from a server-owned catalog/title map supplied
 *   at draft creation, or from a title already carried in signed draft
 *   state. It is never a variant ID.
 * - If no valid name or title is available, callers fail closed with
 *   muse_review_seller_display_required / muse_review_item_title_required.
 *   A degraded review with a raw ID is not an acceptable fallback.
 */

export interface CompanyConnectorManifestLike {
  companyId: string;
  displayName: string;
  status: 'ACTIVE' | 'PAUSED';
}

const rawIdPattern = /gid:\/\/|myshopify\.com|acct_/i;

export function isValidSellerDisplayName(
  name: unknown,
  externalAccountId: string
): name is string {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 160) return false;
  if (trimmed === externalAccountId) return false;
  if (rawIdPattern.test(trimmed)) return false;
  return true;
}

export function validateSellerDisplayName(
  name: unknown,
  externalAccountId: string
): string {
  if (!isValidSellerDisplayName(name, externalAccountId)) {
    throw new Error('muse_review_seller_display_required');
  }
  return (name as string).trim();
}

export function resolveSellerDisplayNameFromManifest(
  manifest: CompanyConnectorManifestLike | null | undefined,
  companyId: string,
  externalAccountId: string
): string {
  if (!manifest) throw new Error('muse_review_seller_display_required');
  if (manifest.companyId !== companyId) {
    throw new Error('muse_review_seller_display_required');
  }
  if (manifest.status !== 'ACTIVE') {
    throw new Error('muse_review_seller_display_required');
  }
  return validateSellerDisplayName(manifest.displayName, externalAccountId);
}

/**
 * Process-local, server-owned company display-name registry.
 *
 * Only server code may register a name, and only after validating it.
 * Draft creation by an authenticated company caller registers the name
 * that caller supplied and validated; the Muse host resolver below reads
 * it back. This registry is intentionally process-local: it is lost on
 * restart, and it is not a persisted manifest store. The signed draft
 * state remains the primary, durable path — a draft created with a
 * validated display name carries that name in its signed state, so a
 * review does not depend on this registry surviving a restart.
 * A persisted manifest store (for example, backed by the MCP
 * ConnectorRegistry) is the follow-up integration; until it exists, a
 * company with no signed draft display name and no registered name
 * fails closed, by design.
 *
 * Persisted-store check, 2026-10-26: no suitable persisted store was
 * found without a major migration. ConnectorRegistry in
 * services/mcp-gateway/src/business-connectors.ts is also a
 * process-local Map, lives in a different service from the API host,
 * and is not shared with it. The API readiness, transaction, and
 * identity stores persist drafts, transactions, readiness, and
 * identities — none maps companyId to a display name. Replacing this
 * registry would therefore require a new persisted manifest store,
 * a schema/migration, and cross-service sharing, which is out of
 * scope for this task and is intentionally NOT invented here. The
 * signed draft state remains the durable path: a draft created with
 * a validated display name carries that name in its signed state,
 * so a review does not depend on this registry surviving a restart.
 */
const serverCompanyDisplayNames = new Map<string, string>();

export function registerServerCompanyDisplayName(
  companyId: string,
  displayName: string,
  externalAccountId: string
): string {
  const validated = validateSellerDisplayName(displayName, externalAccountId);
  serverCompanyDisplayNames.set(companyId, validated);
  return validated;
}

export function resolveServerCompanyDisplayName(
  companyId: string
): string | null {
  return serverCompanyDisplayNames.get(companyId) ?? null;
}

export function createServerCompanyDisplayResolver(
  externalAccountIdForCompany?: (companyId: string) => string | undefined
): (companyId: string) => Promise<string | null> {
  return async (companyId: string) => {
    const name = resolveServerCompanyDisplayName(companyId);
    if (!name) return null;
    const externalAccountId = externalAccountIdForCompany?.(companyId) ?? '';
    // Re-validate at read time: a name that would now be rejected
    // (for example, because it equals the account ID) must not leak.
    return isValidSellerDisplayName(name, externalAccountId) ? name : null;
  };
}

export interface DraftItemTitleInput {
  variantId: string;
  quantity: number;
  unitPrice: string;
}

export function isValidItemTitle(title: unknown, variantId: string): title is string {
  if (typeof title !== 'string') return false;
  const trimmed = title.trim();
  if (!trimmed) return false;
  if (trimmed === variantId) return false;
  if (/gid:\/\//.test(trimmed)) return false;
  return true;
}

export function isValidReviewFact(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 1000) return false;
  if (rawIdPattern.test(trimmed)) return false;
  return true;
}

/**
 * Validate an optional, server-owned review fact (refund/cancellation
 * terms, payment timing, or estimated arrival) supplied at draft
 * creation. Undefined means "not available" downstream. A supplied
 * value must be a real, trimmed string, at most 1000 characters, and
 * must not look like a raw provider ID; otherwise draft creation
 * rejects it instead of storing a fact the review could not render.
 * Estimated arrival is only a supplied fulfillment estimate — this
 * validator never invents a date.
 */
export function validateOptionalReviewFact(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isValidReviewFact(value)) {
    throw new Error('muse_review_fact_invalid');
  }
  return (value as string).trim();
}

export function validateItemTitle(title: unknown, variantId: string): string {
  if (!isValidItemTitle(title, variantId)) {
    throw new Error('muse_review_item_title_required');
  }
  return (title as string).trim();
}

/**
 * Resolve a title for every draft line from a server-owned title map.
 * Every line must resolve; a missing or invalid title fails closed
 * instead of falling back to the variant ID.
 */
export function resolveDraftItemTitles(
  lines: DraftItemTitleInput[],
  titlesByVariantId: Record<string, string> | undefined
): Array<{ variantId: string; quantity: number; unitPrice: string; title: string }> {
  return lines.map((line) => {
    const candidate = titlesByVariantId?.[line.variantId];
    return {
      variantId: line.variantId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      title: validateItemTitle(candidate, line.variantId),
    };
  });
}
