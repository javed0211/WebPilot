import type {
  CompletenessGrade,
  CompletenessReport,
  CompletenessThresholds,
  EvidenceBundle,
} from './types';
import { DEFAULT_COMPLETENESS_THRESHOLDS } from './types';

function gradeForScore(score: number): CompletenessGrade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 55) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

/**
 * Grades how governance-complete the evidence pack is (A–F).
 * Completeness is orthogonal to risk: a green thin run can still be grade C/D.
 */
export class CompletenessGrader {
  public static grade(
    partial: Pick<
      EvidenceBundle,
      | 'status'
      | 'timeline'
      | 'locators'
      | 'assertions'
      | 'artifacts'
      | 'llmUsage'
      | 'codegen'
      | 'healing'
    >,
    thresholds: CompletenessThresholds = DEFAULT_COMPLETENESS_THRESHOLDS
  ): CompletenessReport {
    const missing: string[] = [];
    const warnings: string[] = [];
    let score = 0;

    const timelineLen = partial.timeline?.length ?? 0;
    if (timelineLen > 0) {
      score += 25;
    } else {
      missing.push('step-timeline');
    }

    const locTotal = partial.locators?.total ?? 0;
    const verifiedRatio = partial.locators?.verifiedRatio ?? 0;
    if (locTotal > 0) {
      score += 15;
      if (verifiedRatio >= thresholds.requireVerifiedLocatorRatio) {
        score += 15;
      } else {
        score += Math.round(15 * verifiedRatio);
        warnings.push(
          `${partial.locators.unverified} unverified locator(s) (ratio ${verifiedRatio.toFixed(2)})`
        );
        missing.push('verified-locator-ratio');
      }
    } else if (timelineLen > 0) {
      warnings.push('No locator metadata on timeline steps');
      missing.push('locator-verification');
    }

    const hasMedia =
      Boolean(partial.artifacts?.trace) ||
      Boolean(partial.artifacts?.video) ||
      (partial.artifacts?.screenshots?.length ?? 0) > 0;
    if (hasMedia) {
      score += 15;
    } else {
      missing.push('media-artifacts');
      if (partial.status === 'FAILED' && thresholds.requireTraceOnFailure) {
        warnings.push('Missing trace/screenshot on failure');
      }
    }

    const assertionsExecuted = partial.assertions?.executed ?? 0;
    const assertionsPlanned = partial.assertions?.planned ?? 0;
    if (assertionsExecuted > 0 || assertionsPlanned > 0) {
      score += 15;
    } else if (partial.status === 'PASSED' && thresholds.requireAssertionOnPass) {
      missing.push('assertions');
      warnings.push('Passed without recorded assertions');
    } else {
      score += 5;
    }

    const usage = partial.llmUsage;
    if (usage && (usage.totalTokens > 0 || usage.llmCalls > 0)) {
      score += 10;
    } else {
      missing.push('llm-usage');
    }

    if (partial.codegen?.quality) {
      score += 5;
      if (partial.codegen.quality === 'degraded') {
        warnings.push(
          `codegen quality degraded${
            partial.codegen.qualityReasons?.length
              ? `: ${partial.codegen.qualityReasons.join('; ')}`
              : ''
          }`
        );
      }
    }

    // Bonus for heal ledger presence (even if empty count recorded)
    if (partial.healing && typeof partial.healing.count === 'number') {
      score += 5;
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    return {
      grade: gradeForScore(score),
      score,
      missing,
      warnings,
    };
  }
}
