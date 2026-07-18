import type { ExecutionEventLedger } from '../events/ExecutionEventLedger';
import type { HealingValidationEvidence } from './HealingTypes';

export interface PostActionValidationInput {
  candidateUnique: boolean;
  actionSucceeded: boolean;
  actionError?: string;
  proposalConfidence: number;
  brokenSelector: string;
  healedSelector: string;
  url?: string;
  /** Optional explicit postcondition from capability/semantic assertion. */
  postconditionSucceeded?: boolean | null;
  assertionSucceeded?: boolean | null;
  /** Count events after this sequence number (heal proposal event). */
  ledger?: ExecutionEventLedger | null;
  afterSequence?: number;
  semanticSimilarity?: number;
}

/**
 * Collect post-action validation evidence for the healing classifier.
 */
export class HealingPostActionValidator {
  public static collect(input: PostActionValidationInput): HealingValidationEvidence {
    let networkFailures = 0;
    let consoleErrors = 0;

    if (input.ledger && input.afterSequence != null) {
      for (const event of input.ledger.getEvents()) {
        if (event.sequence <= input.afterSequence) continue;
        if (event.kind === 'network' && event.outcome === 'failed') networkFailures += 1;
        if (
          (event.kind === 'console' || event.kind === 'page_error') &&
          event.outcome === 'failed'
        ) {
          consoleErrors += 1;
        }
      }
    }

    return {
      candidateUnique: input.candidateUnique,
      actionSucceeded: input.actionSucceeded,
      actionError: input.actionError,
      postconditionSucceeded: input.postconditionSucceeded ?? null,
      assertionSucceeded: input.assertionSucceeded ?? null,
      networkFailures,
      consoleErrors,
      semanticSimilarity: input.semanticSimilarity,
      proposalConfidence: input.proposalConfidence,
      brokenSelector: input.brokenSelector,
      healedSelector: input.healedSelector,
      url: input.url,
    };
  }
}
