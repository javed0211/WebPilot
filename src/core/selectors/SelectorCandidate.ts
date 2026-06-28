export type SelectorCandidateKind =
  | 'role'
  | 'label'
  | 'placeholder'
  | 'testid'
  | 'text'
  | 'css'
  | 'xpath'
  | 'unknown';

export interface SelectorCandidate {
  kind: SelectorCandidateKind;
  value: string;
  frameworkExpression: string;
  confidence: number;
  signals: string[];
  risks: string[];
  createdAt: string;
}

export interface RankedSelectorSet {
  primary: SelectorCandidate;
  fallbacks: SelectorCandidate[];
}

export interface SelectorRegistryEntry {
  primary: SelectorCandidate;
  fallbacks: SelectorCandidate[];
  lastVerifiedAt?: string;
  successCount: number;
  failureCount: number;
}

export interface SelectorRegistryFile {
  version: string;
  updatedAt: string;
  selectors: Record<string, Record<string, SelectorRegistryEntry>>;
}
