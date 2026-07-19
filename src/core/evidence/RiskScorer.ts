import type {
  CompletenessReport,
  EvidenceBundle,
  RiskFactor,
  RiskLevel,
  RiskReport,
  RiskWeights,
} from './types';
import { DEFAULT_RISK_WEIGHTS } from './types';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function levelForScore(score: number): RiskLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

/**
 * Deterministic, explainable risk score — no LLM at report time.
 * Orthogonal to pass/fail: a green run can still be medium/high.
 */
export class RiskScorer {
  public static score(
    partial: Pick<
      EvidenceBundle,
      | 'status'
      | 'healing'
      | 'codegen'
      | 'locators'
      | 'assertions'
      | 'flake'
      | 'artifacts'
      | 'pageInventory'
      | 'llmUsage'
    >,
    weights: RiskWeights = DEFAULT_RISK_WEIGHTS
  ): RiskReport {
    const factors: RiskFactor[] = [];
    let score = 0;

    const add = (id: string, weight: number, detail: string) => {
      if (weight <= 0) return;
      factors.push({ id, weight, detail });
      score += weight;
    };

    if (partial.status === 'FAILED') {
      add('run-failed', weights.failWeight, 'Run status is FAILED');
    }

    const flakeConf = partial.flake?.confidence;
    if (
      partial.flake?.category &&
      typeof flakeConf === 'number' &&
      flakeConf >= 0.7
    ) {
      add(
        'flake-high-confidence',
        weights.flakeHighConfidence,
        `Flake ${partial.flake.category} (confidence ${flakeConf.toFixed(2)})`
      );
    }

    const healCount = partial.healing?.count ?? 0;
    if (healCount > 0) {
      const healWeight = clamp(healCount * weights.healingPerStep, 0, weights.healingCap);
      add('healing-used', healWeight, `${healCount} healed step(s)`);
    }

    if (partial.codegen?.quality === 'degraded') {
      add(
        'codegen-degraded',
        weights.codegenDegraded,
        (partial.codegen.qualityReasons || []).join('; ') || 'raw fallback / degraded codegen'
      );
    }

    const verifiedRatio = partial.locators?.verifiedRatio;
    if (typeof verifiedRatio === 'number' && partial.locators.total > 0) {
      const unverifiedWeight = Math.round((1 - verifiedRatio) * weights.unverifiedLocatorMax);
      if (unverifiedWeight > 0) {
        add(
          'unverified-locators',
          unverifiedWeight,
          `${partial.locators.unverified}/${partial.locators.total} unverified`
        );
      }
    }

    const strong = partial.assertions?.strong ?? 0;
    const executed = partial.assertions?.executed ?? 0;
    if (partial.status === 'PASSED' && executed > 0 && strong === 0) {
      add('weak-assertions-only', weights.weakAssertionOnly, 'No strong assertions on success path');
    }

    if (partial.status === 'FAILED') {
      const hasTrace = Boolean(partial.artifacts?.trace);
      const hasShot = (partial.artifacts?.screenshots?.length ?? 0) > 0;
      if (!hasTrace && !hasShot) {
        add(
          'missing-failure-artifacts',
          weights.missingFailureArtifacts,
          'No trace or screenshot on failure'
        );
      }
    }

    const driftCount = partial.pageInventory?.drift?.length ?? 0;
    if (driftCount > 0) {
      add('page-drift', weights.pageDrift, `${driftCount} page(s) with inventory drift`);
    }

    const cost = partial.llmUsage?.estimatedCostUsd ?? 0;
    if (cost >= 0.1) {
      add('high-llm-spend', weights.highLlmSpend, `LLM spend $${cost.toFixed(3)}`);
    }

    score = clamp(Math.round(score), 0, 100);
    return { score, level: levelForScore(score), factors };
  }
}

/** Re-export for callers that only need grade helpers alongside risk. */
export type { CompletenessReport };
