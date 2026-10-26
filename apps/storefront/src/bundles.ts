export type BundleLabel = 'BEST COMPLETE CART' | 'SMARTER VALUE CART' | 'UPGRADE THE SIGNAL';

export interface BundleItemView {
  productId: string;
  title: string;
  price: number;
  currency: string;
  role: string;
  whyItFits: string;
}

export interface BundleCardView {
  bundleId: string;
  label: BundleLabel;
  total: number;
  targetBudget: number;
  budgetUtilizationPercent: number | null;
  items: BundleItemView[];
  whyTogether: string[];
}

export interface BundleResultsView {
  requestId: string;
  hardBudget: boolean;
  bundles: BundleCardView[];
}

export function bundleLabel(mode: string): BundleLabel {
  if (mode === 'SMARTER_VALUE_CART') return 'SMARTER VALUE CART';
  if (mode === 'UPGRADE_THE_SIGNAL') return 'UPGRADE THE SIGNAL';
  return 'BEST COMPLETE CART';
}

export const bundleUiRules = {
  explanationHeading: 'Why these work together',
  showBudgetUtilization: true,
  showDeliveryOnlyWithEvidence: true,
  neverInventClaims: true
};
