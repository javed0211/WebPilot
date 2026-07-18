import * as fs from 'fs';
import * as path from 'path';
import type { ExecutionEventLedger } from '../events/ExecutionEventLedger';
import { resolveFeatureFlags, type WebPilotFeatureFlags } from '../lifecycle/FeatureFlags';
import { HealingClassifier } from './HealingClassifier';
import { HealingCommitPolicy } from './HealingCommitPolicy';
import { HealingPostActionValidator } from './HealingPostActionValidator';
import type {
  HealingClassification,
  HealingCommitDecision,
  HealingTransactionState,
  HealingValidationEvidence,
} from './HealingTypes';
import { HEALING_CLASSIFICATION_SCHEMA_VERSION } from './HealingTypes';

export interface HealingProposalInput {
  brokenSelector: string;
  healedSelector: string;
  confidence: number;
  reasoning: string;
  proposalPath?: string;
  url?: string;
  actionType?: string;
}

export interface HealingTransactionResult {
  state: HealingTransactionState;
  classification: HealingClassification;
  decision: HealingCommitDecision;
  evidence: HealingValidationEvidence;
  committed: boolean;
}

/**
 * State machine: proposed → verified → attempted → validated → committed|rejected|quarantined.
 */
export class HealingTransaction {
  private state: HealingTransactionState = 'proposed';
  private proposal: HealingProposalInput;
  private flags: WebPilotFeatureFlags;
  private ledger: ExecutionEventLedger | null;
  private proposeSequence?: number;
  private candidateUnique = false;
  private actionSucceeded = false;
  private actionError?: string;
  private postconditionSucceeded: boolean | null = null;
  private assertionSucceeded: boolean | null = null;

  constructor(
    proposal: HealingProposalInput,
    options: {
      flags?: WebPilotFeatureFlags;
      ledger?: ExecutionEventLedger | null;
      proposeSequence?: number;
    } = {}
  ) {
    this.proposal = proposal;
    this.flags = options.flags || resolveFeatureFlags();
    this.ledger = options.ledger ?? null;
    this.proposeSequence = options.proposeSequence;
  }

  public getState(): HealingTransactionState {
    return this.state;
  }

  public markCandidateVerified(unique: boolean): void {
    this.candidateUnique = unique;
    this.state = 'candidate_verified';
  }

  public markActionAttempted(succeeded: boolean, error?: string): void {
    this.actionSucceeded = succeeded;
    this.actionError = error;
    this.state = 'action_attempted';
  }

  public markPostcondition(succeeded: boolean | null): void {
    this.postconditionSucceeded = succeeded;
  }

  public markAssertion(succeeded: boolean | null): void {
    this.assertionSucceeded = succeeded;
  }

  /**
   * Classify and optionally commit to healing cache + inventory callbacks.
   */
  public finalize(callbacks?: {
    saveToCache?: (broken: string, healed: string) => void;
    upsertInventory?: (healedSelector: string, url?: string) => void;
  }): HealingTransactionResult {
    const evidence = HealingPostActionValidator.collect({
      candidateUnique: this.candidateUnique,
      actionSucceeded: this.actionSucceeded,
      actionError: this.actionError,
      proposalConfidence: this.proposal.confidence,
      brokenSelector: this.proposal.brokenSelector,
      healedSelector: this.proposal.healedSelector,
      url: this.proposal.url,
      postconditionSucceeded: this.postconditionSucceeded,
      assertionSucceeded: this.assertionSucceeded,
      ledger: this.ledger,
      afterSequence: this.proposeSequence,
      semanticSimilarity: HealingClassifier.estimateSemanticSimilarity(
        this.proposal.brokenSelector,
        this.proposal.healedSelector
      ),
    });

    this.state = 'post_action_validated';
    const classification = HealingClassifier.classify(evidence);
    const decision = HealingCommitPolicy.decide(classification, this.flags, {
      actionSucceeded: this.actionSucceeded && this.candidateUnique,
    });

    this.state = decision.state;

    if (decision.commit) {
      callbacks?.saveToCache?.(this.proposal.brokenSelector, this.proposal.healedSelector);
      callbacks?.upsertInventory?.(this.proposal.healedSelector, this.proposal.url);
    }

    this.ledger?.append({
      kind: 'healing',
      phase: 'validate',
      outcome: decision.commit ? 'passed' : 'failed',
      payload: {
        schemaVersion: HEALING_CLASSIFICATION_SCHEMA_VERSION,
        state: decision.state,
        committed: decision.commit,
        decisionReason: decision.reason,
        classification: classification.label,
        classificationConfidence: classification.confidence,
        classificationReasons: classification.reasons,
        brokenSelector: this.proposal.brokenSelector,
        healedSelector: this.proposal.healedSelector,
        proposalConfidence: this.proposal.confidence,
        actionSucceeded: this.actionSucceeded,
        candidateUnique: this.candidateUnique,
        postconditionSucceeded: this.postconditionSucceeded,
        networkFailures: evidence.networkFailures,
        consoleErrors: evidence.consoleErrors,
      },
    });

    return {
      state: decision.state,
      classification,
      decision,
      evidence,
      committed: decision.commit,
    };
  }

  /** Persist a classification sidecar next to a proposal file when present. */
  public static writeClassificationSidecar(
    proposalPath: string | undefined,
    result: HealingTransactionResult
  ): string | undefined {
    if (!proposalPath || !fs.existsSync(proposalPath)) return undefined;
    try {
      const sidecar = proposalPath.replace(/\.json$/i, '.classification.json');
      fs.writeFileSync(
        sidecar,
        JSON.stringify(
          {
            schemaVersion: HEALING_CLASSIFICATION_SCHEMA_VERSION,
            proposalPath,
            createdAt: new Date().toISOString(),
            ...result,
          },
          null,
          2
        ),
        'utf8'
      );
      return sidecar;
    } catch {
      return undefined;
    }
  }
}
