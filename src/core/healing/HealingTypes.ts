/**
 * Healing change classification + transaction contracts.
 */

export type HealingClassificationLabel =
  | 'likely_intentional_refactor'
  | 'possible_regression'
  | 'inconclusive';

export type HealingTransactionState =
  | 'proposed'
  | 'candidate_verified'
  | 'action_attempted'
  | 'post_action_validated'
  | 'committed'
  | 'rejected'
  | 'quarantined'
  | 'legacy';

export interface HealingClassification {
  label: HealingClassificationLabel;
  confidence: number;
  reasons: string[];
  evidenceRefs?: string[];
}

export interface HealingValidationEvidence {
  /** Healed locator became visible/unique before the action. */
  candidateUnique: boolean;
  /** Click/fill (or equivalent) completed without throwing. */
  actionSucceeded: boolean;
  actionError?: string;
  /** Optional business postcondition / semantic assertion result. null = not evaluated. */
  postconditionSucceeded?: boolean | null;
  assertionSucceeded?: boolean | null;
  /** Network failures observed on the page after the heal proposal. */
  networkFailures?: number;
  /** Console/page errors after the heal proposal. */
  consoleErrors?: number;
  /** Heuristic 0..1 similarity between broken and healed selector semantics. */
  semanticSimilarity?: number;
  /** LLM/healer confidence for the replacement. */
  proposalConfidence: number;
  brokenSelector: string;
  healedSelector: string;
  url?: string;
}

export interface HealingCommitDecision {
  commit: boolean;
  state: HealingTransactionState;
  reason: string;
  classification: HealingClassification;
}

export const HEALING_CLASSIFICATION_SCHEMA_VERSION = 1 as const;
