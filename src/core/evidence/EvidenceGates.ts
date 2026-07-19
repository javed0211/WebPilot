import type { CompletenessGrade, RiskLevel } from './types';
import type { SuiteExecutionReport, TestCaseReport } from '../execution_report/types';

const GRADE_RANK: Record<CompletenessGrade, number> = {
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  F: 1,
};

const RISK_RANK: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export interface EvidenceGateOptions {
  /** Minimum completeness grade (A–F). Fail when actual is worse. */
  requireEvidenceGrade?: CompletenessGrade;
  /** Maximum allowed risk level. Fail when actual is higher. */
  maxRisk?: RiskLevel;
}

export interface EvidenceGateViolation {
  slug: string;
  code: 'missing_evidence' | 'grade_below_required' | 'risk_above_max';
  message: string;
}

export interface EvidenceGateResult {
  ok: boolean;
  violations: EvidenceGateViolation[];
}

export function parseCompletenessGrade(raw: unknown): CompletenessGrade | undefined {
  if (typeof raw !== 'string') return undefined;
  const g = raw.trim().toUpperCase();
  if (g === 'A' || g === 'B' || g === 'C' || g === 'D' || g === 'F') return g;
  return undefined;
}

export function parseRiskLevel(raw: unknown): RiskLevel | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'low' || v === 'medium' || v === 'high' || v === 'critical') return v;
  return undefined;
}

function evaluateTest(
  t: TestCaseReport,
  options: EvidenceGateOptions
): EvidenceGateViolation[] {
  const violations: EvidenceGateViolation[] = [];
  const needsGate = Boolean(options.requireEvidenceGrade || options.maxRisk);
  if (!needsGate) return violations;

  if (!t.completeness && !t.risk) {
    violations.push({
      slug: t.slug,
      code: 'missing_evidence',
      message: `${t.slug}: no evidence risk/completeness on summary (run report with evidence.enabled)`,
    });
    return violations;
  }

  if (options.requireEvidenceGrade) {
    const actual = t.completeness?.grade;
    if (!actual) {
      violations.push({
        slug: t.slug,
        code: 'missing_evidence',
        message: `${t.slug}: missing completeness grade`,
      });
    } else if (GRADE_RANK[actual] < GRADE_RANK[options.requireEvidenceGrade]) {
      violations.push({
        slug: t.slug,
        code: 'grade_below_required',
        message: `${t.slug}: completeness ${actual} is below required ${options.requireEvidenceGrade}`,
      });
    }
  }

  if (options.maxRisk) {
    const actual = t.risk?.level;
    if (!actual) {
      violations.push({
        slug: t.slug,
        code: 'missing_evidence',
        message: `${t.slug}: missing risk level`,
      });
    } else if (RISK_RANK[actual] > RISK_RANK[options.maxRisk]) {
      violations.push({
        slug: t.slug,
        code: 'risk_above_max',
        message: `${t.slug}: risk ${actual} exceeds max ${options.maxRisk}`,
      });
    }
  }

  return violations;
}

/**
 * CI / report gate: fail when any test violates grade or risk thresholds.
 */
export function evaluateEvidenceGates(
  report: SuiteExecutionReport,
  options: EvidenceGateOptions
): EvidenceGateResult {
  const violations: EvidenceGateViolation[] = [];
  for (const t of report.testCases) {
    violations.push(...evaluateTest(t, options));
  }
  return { ok: violations.length === 0, violations };
}

export function formatEvidenceGateFailures(result: EvidenceGateResult): string {
  if (result.ok) return '';
  return result.violations.map((v) => `  - ${v.message}`).join('\n');
}
