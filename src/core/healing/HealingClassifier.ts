import type {
  HealingClassification,
  HealingValidationEvidence,
} from './HealingTypes';

/**
 * Deterministic classifier: intentional refactor vs regression vs inconclusive.
 * LLM confidence is an input signal, never the sole authority.
 */
export class HealingClassifier {
  public static classify(evidence: HealingValidationEvidence): HealingClassification {
    const reasons: string[] = [];
    const similarity =
      evidence.semanticSimilarity ??
      HealingClassifier.estimateSemanticSimilarity(
        evidence.brokenSelector,
        evidence.healedSelector
      );

    if (!evidence.candidateUnique) {
      return {
        label: 'possible_regression',
        confidence: 0.7,
        reasons: ['Healed candidate was not uniquely visible before the action'],
      };
    }

    if (!evidence.actionSucceeded) {
      return {
        label: 'possible_regression',
        confidence: 0.85,
        reasons: [
          'Healed locator was visible but the intended action failed',
          evidence.actionError || 'action error',
        ],
      };
    }

    reasons.push('Healed candidate was unique and the action succeeded');

    const networkFailures = evidence.networkFailures ?? 0;
    const consoleErrors = evidence.consoleErrors ?? 0;
    if (networkFailures > 0) {
      reasons.push(`${networkFailures} network failure(s) after heal`);
    }
    if (consoleErrors > 0) {
      reasons.push(`${consoleErrors} console/page error(s) after heal`);
    }

    if (evidence.postconditionSucceeded === false) {
      return {
        label: 'possible_regression',
        confidence: 0.9,
        reasons: [...reasons, 'Business postcondition failed after healed action'],
      };
    }

    if (evidence.assertionSucceeded === false) {
      return {
        label: 'possible_regression',
        confidence: 0.88,
        reasons: [...reasons, 'Assertion failed after healed action'],
      };
    }

    if (networkFailures > 0 || consoleErrors > 0) {
      return {
        label: 'possible_regression',
        confidence: 0.8,
        reasons,
      };
    }

    const hasStrongPostcondition =
      evidence.postconditionSucceeded === true || evidence.assertionSucceeded === true;

    const highProposalConfidence = evidence.proposalConfidence >= 0.85;
    const similarEnough = similarity >= 0.45;
    const verySimilar = similarity >= 0.7;

    if (hasStrongPostcondition && (similarEnough || highProposalConfidence)) {
      reasons.push(
        hasStrongPostcondition
          ? 'Postcondition/assertion passed'
          : 'No postcondition (should not reach here)'
      );
      if (similarEnough) {
        reasons.push(`Semantic similarity ${similarity.toFixed(2)} preserved intent`);
      }
      return {
        label: 'likely_intentional_refactor',
        confidence: Math.min(
          0.95,
          0.55 + evidence.proposalConfidence * 0.25 + similarity * 0.2
        ),
        reasons,
      };
    }

    // Action succeeded with no contradictory signals, but no business proof.
    if (
      evidence.postconditionSucceeded == null &&
      evidence.assertionSucceeded == null &&
      (verySimilar || (similarEnough && highProposalConfidence))
    ) {
      reasons.push(
        'No business postcondition available — treating as inconclusive despite clean action'
      );
      return {
        label: 'inconclusive',
        confidence: 0.55,
        reasons: [
          ...reasons,
          `Semantic similarity ${similarity.toFixed(2)}`,
          `Proposal confidence ${evidence.proposalConfidence.toFixed(2)}`,
        ],
      };
    }

    if (
      evidence.postconditionSucceeded == null &&
      evidence.assertionSucceeded == null
    ) {
      return {
        label: 'inconclusive',
        confidence: 0.5,
        reasons: [
          ...reasons,
          'No postcondition or assertion to prove business outcome',
          `Semantic similarity ${similarity.toFixed(2)}`,
        ],
      };
    }

    // Postcondition true but weak similarity / confidence
    if (hasStrongPostcondition) {
      reasons.push('Postcondition passed but selector semantics are weak — inconclusive');
      return {
        label: 'inconclusive',
        confidence: 0.6,
        reasons: [...reasons, `Semantic similarity ${similarity.toFixed(2)}`],
      };
    }

    return {
      label: 'inconclusive',
      confidence: 0.45,
      reasons: reasons.length ? reasons : ['Insufficient evidence to classify heal'],
    };
  }

  /**
   * Rough token overlap between broken and healed selector strings.
   * Prefers accessible-name / role / testid tokens over raw CSS noise.
   */
  public static estimateSemanticSimilarity(broken: string, healed: string): number {
    const a = HealingClassifier.tokens(broken);
    const b = HealingClassifier.tokens(healed);
    if (!a.size || !b.size) return 0;
    let overlap = 0;
    for (const t of a) {
      if (b.has(t)) overlap += 1;
    }
    return overlap / Math.max(a.size, b.size);
  }

  private static tokens(selector: string): Set<string> {
    const normalized = selector
      .toLowerCase()
      .replace(/['"`]/g, ' ')
      .replace(/[^a-z0-9_\-\s=]/g, ' ');
    const parts = normalized
      .split(/[\s=_:.\-\[\]()]+/)
      .map((p) => p.trim())
      .filter(
        (p) =>
          p.length >= 2 &&
          !['getbyrole', 'getbytext', 'getbytestid', 'getbylabel', 'page', 'locator', 'css', 'xpath', 'name', 'role', 'true', 'false'].includes(
            p
          )
      );
    return new Set(parts);
  }
}
