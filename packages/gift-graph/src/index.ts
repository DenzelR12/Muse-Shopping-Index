export interface PreferenceFact {
  subjectId: string;
  predicate: string;
  value: string;
  provenance: 'stated'|'inferred'|'transaction'|'operational';
  confidence: number;
  observedAt: string;
}
export interface GiftOutcomeEdge {
  contextId: string;
  productId: string;
  purchased: boolean;
  deliveredOnTime?: boolean;
  returned?: boolean;
  satisfaction?: number;
}
