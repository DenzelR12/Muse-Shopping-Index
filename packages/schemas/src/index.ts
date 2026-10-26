export type DeliveryTier = '10_MIN'|'TOMORROW'|'3_DAYS'|'THIS_WEEK'|'NO_RUSH';
export type ExperienceTier = 'SIGNAL_EDITION'|'SIGNAL_VERIFIED'|'SIGNAL_INSTANT';

export interface GiftContext {
  recipient?: string;
  relationship?: string;
  occasion?: string;
  interests?: string[];
  avoid?: string[];
  budgetMin?: number;
  budgetMax?: number;
  hardBudget?: boolean;
  deliveryTier?: DeliveryTier;
  destinationCountry?: string;
}

export interface ProductCandidate {
  productId: string;
  variantId?: string;
  variantTitle?: string;
  sku?: string;
  brand?: string;
  description?: string;
  images?: ProductImage[];
  includedItems?: string[];
  attributes?: Record<string,string>;
  sourceUpdatedAt?: string;
  /** Shopify Standard Product Taxonomy category supplied by the catalog source. */
  productCategory?: string;
  /** Merchant-maintained product type supplied by the catalog source. */
  productType?: string;
  /** True only when the source identity, variant, media, price and availability have been checked. */
  evidenceVerified?: boolean;
  /** True only when the product belongs to the configured Signal Verified Shopify collection. */
  signalVerified?: boolean;
  title: string;
  price: number;
  currency: string;
  inStock: boolean;
  recipientFit: string[];
  occasionFit: string[];
  semanticIntents: string[];
  useCases: string[];
  bundleRoles: string[];
  semanticSummary?: string;
  deliveryConfidence?: number;
  semanticCompleteness?: number;
}

export interface ProductImage {
  url: string;
  alt: string;
  /** Set only when the source explicitly associates this image with a variant. */
  variantId?: string;
}

export interface Recommendation {
  rank: number;
  label: 'BEST_SIGNAL'|'SMARTER_VALUE'|'LET_THEM_CHOOSE';
  product: ProductCandidate;
  score: number;
  why: string[];
}

export interface BundlePlan {
  items: ProductCandidate[];
  total: number;
  targetBudget: number;
  delta: number;
  mode: 'BEST_COMPLETE_CART'|'SMARTER_VALUE_CART'|'UPGRADE_THE_SIGNAL';
  whyTogether: string[];
}

export interface GroupGiftEvent {
  eventId: string;
  organizerId: string;
  productId: string;
  targetAmount: number;
  fundedAmount: number;
  currency: string;
  deadline?: string;
  status: 'DRAFT'|'OPEN'|'FUNDED'|'FULFILLED'|'CANCELLED';
  revocationVersion: number;
}
