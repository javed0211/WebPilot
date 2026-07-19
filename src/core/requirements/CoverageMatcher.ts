import * as fs from 'fs';
import * as path from 'path';
import { PROJECT_ROOT } from '../ProjectPaths';
import {
  CoverageReport,
  CoverageState,
  CriterionCoverage,
  NormalizedRequirement,
  RequirementCoverage,
  RequirementMapFile,
  RequirementRisk,
  RequirementSet,
  ReconcileFinding,
  ReconcileReport,
  ReconcileStatus,
  TestEvidence,
} from './types';
import { TestArtifact } from './TestInventory';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are', 'be',
  'as', 'at', 'by', 'it', 'this', 'that', 'should', 'must', 'can', 'able', 'will', 'shall',
  'user', 'users', 'system', 'page', 'when', 'then', 'given', 'i', 'we', 'they', 'from',
  'into', 'their', 'displayed', 'verify', 'check', 'ensure', 'see', 'shown', 'able',
]);

/** Action/intent keywords that strongly indicate the same behavior. */
const INTENT_KEYWORDS = [
  'login', 'log in', 'sign in', 'signin', 'logout', 'register', 'sign up', 'signup',
  'search', 'filter', 'sort', 'add to cart', 'cart', 'checkout', 'payment', 'pay',
  'navigate', 'open', 'submit', 'upload', 'download', 'delete', 'remove', 'update',
  'create', 'edit', 'select', 'book', 'booking', 'reserve', 'date', 'calendar',
];

const MATCH_THRESHOLD = 0.42;
const COVERED_SCORE = 0.7;
const LOW_QUALITY_CEIL = 0.55;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function intents(text: string): Set<string> {
  const lowered = text.toLowerCase();
  const found = new Set<string>();
  for (const kw of INTENT_KEYWORDS) {
    if (lowered.includes(kw)) found.add(kw.replace(/\s+/g, ''));
  }
  return found;
}

function jaccardCoverage(criterionTokens: string[], testTokens: Set<string>): number {
  if (criterionTokens.length === 0) return 0;
  let hits = 0;
  for (const token of new Set(criterionTokens)) {
    if (testTokens.has(token)) hits += 1;
  }
  return hits / new Set(criterionTokens).size;
}

interface ScoredTest {
  evidence: TestEvidence;
  matchedSteps: number[];
}

/**
 * Deterministic semantic baseline matcher. Scores a single test against one
 * acceptance criterion using token overlap, intent-keyword alignment, tag/id
 * hints, and execution status. This is the offline baseline the AI-assisted
 * discovery layer builds on top of (LLM can re-rank or fill gaps later).
 */
function scoreTestAgainstCriterion(
  requirement: NormalizedRequirement,
  criterionText: string,
  criterionId: string,
  test: TestArtifact,
  map: RequirementMapFile
): ScoredTest | null {
  const critTokens = tokenize(criterionText);
  const testTokens = new Set(tokenize(test.blob));
  let semantic = jaccardCoverage(critTokens, testTokens);

  const critIntents = intents(criterionText);
  const testIntents = intents(test.blob);
  let intentHits = 0;
  for (const intent of critIntents) if (testIntents.has(intent)) intentHits += 1;
  const intentBoost = critIntents.size > 0 ? (intentHits / critIntents.size) * 0.25 : 0;

  const evidence: TestEvidence['evidence'] = [];

  // Explicit mapping evidence.
  const mapped = map.requirements[requirement.id]?.criteria.find(
    (c) =>
      (c.criterionId && c.criterionId === criterionId) ||
      c.text.trim().toLowerCase() === criterionText.trim().toLowerCase()
  );
  const mappedHere = mapped?.tests.some((t) => t.path === test.path);
  if (mappedHere && mapped) {
    if (mapped.status === 'confirmed') {
      semantic = Math.max(semantic, 0.92);
      evidence.push('mapping');
    } else if (mapped.status === 'proposed') {
      semantic = Math.max(semantic, 0.6);
      evidence.push('mapping');
    } else if (mapped.status === 'rejected') {
      return null;
    }
  }

  // Tag / requirement-id hints in the test.
  const idLower = requirement.id.toLowerCase();
  const tagHit =
    test.tags.some((tag) => tag.toLowerCase().includes(idLower)) ||
    test.blob.includes(idLower);
  if (tagHit) {
    semantic = Math.max(semantic, 0.65);
    evidence.push('tag');
  }

  // Title overlap with requirement title.
  const titleOverlap = jaccardCoverage(tokenize(requirement.title), testTokens);
  if (titleOverlap >= 0.5) evidence.push('title-match');

  let score = Math.min(1, semantic + intentBoost + titleOverlap * 0.1);

  // Identify the most relevant steps for evidence/snippets.
  const matchedSteps: number[] = [];
  for (const step of test.steps) {
    const stepTokens = new Set(tokenize(step.text));
    if (jaccardCoverage(critTokens, stepTokens) >= 0.4) matchedSteps.push(step.index);
  }
  if (matchedSteps.length > 0) evidence.push('semantic-step');

  if (score < MATCH_THRESHOLD) return null;

  if (test.lastStatus) {
    evidence.push(test.lastStatus === 'PASSED' ? 'execution-pass' : 'execution-fail');
  }

  const rawScore = Number(score.toFixed(2));
  const { adjusted, penalty, reasons } = applyGovernancePenalty(rawScore, test);

  return {
    matchedSteps,
    evidence: {
      path: test.path,
      steps: matchedSteps.length > 0 ? matchedSteps : undefined,
      evidence,
      lastStatus: test.lastStatus,
      flakeScore: test.flakeScore,
      rawScore,
      score: adjusted,
      governancePenalty: penalty > 0 ? penalty : undefined,
      penaltyReasons: reasons.length ? reasons : undefined,
      evidenceRef: test.governance?.evidenceRef,
    },
  };
}

/**
 * Soft-penalize coverage credit using Feature 11 risk/completeness.
 * Match threshold still uses raw semantic score so weak-evidence tests stay visible.
 */
function applyGovernancePenalty(
  rawScore: number,
  test: TestArtifact
): { adjusted: number; penalty: number; reasons: string[] } {
  const g = test.governance;
  if (!g) return { adjusted: rawScore, penalty: 0, reasons: [] };

  const reasons: string[] = [];
  let penalty = 0;

  if (typeof g.riskScore === 'number' && g.riskScore > 0) {
    const riskPen = (g.riskScore / 100) * 0.2;
    penalty += riskPen;
    reasons.push(
      `runtime-risk ${g.riskLevel || g.riskScore} (−${riskPen.toFixed(2)})`
    );
    for (const factor of g.riskFactors || []) {
      if (['healing-used', 'unverified-locators', 'codegen-degraded', 'page-drift'].includes(factor)) {
        reasons.push(factor);
      }
    }
  }

  if (typeof g.completenessScore === 'number') {
    const thin = Math.max(0, (100 - g.completenessScore) / 100) * 0.15;
    if (thin > 0) {
      penalty += thin;
      reasons.push(
        `completeness ${g.completenessGrade || g.completenessScore} (−${thin.toFixed(2)})`
      );
    }
  }

  const adjusted = Math.max(0, Number((rawScore - penalty).toFixed(2)));
  return { adjusted, penalty: Number(penalty.toFixed(2)), reasons };
}

function criterionStatus(tests: TestEvidence[]): { status: CoverageState; score: number } {
  if (tests.length === 0) return { status: 'uncovered', score: 0 };
  const best = Math.max(...tests.map((t) => t.score));
  const hasPass = tests.some((t) => t.lastStatus === 'PASSED');
  const hasConfirmedMapping = tests.some((t) => t.evidence.includes('mapping') && t.score >= 0.9);

  if ((best >= COVERED_SCORE && hasPass) || hasConfirmedMapping) {
    return { status: 'covered', score: best };
  }
  return { status: 'partial', score: best };
}

function riskFor(
  priority: string | undefined,
  status: CoverageState
): RequirementRisk {
  if (status === 'covered') return 'low';
  const p = (priority || '').toUpperCase();
  if (p === 'P0' || p === 'P1') return 'high';
  if (status === 'uncovered') return p === 'P2' ? 'high' : 'medium';
  return 'medium';
}

export class CoverageMatcher {
  public static buildCoverage(
    requirementSet: RequirementSet,
    tests: TestArtifact[],
    map: RequirementMapFile
  ): CoverageReport {
    const requirements: RequirementCoverage[] = [];

    for (const requirement of requirementSet.requirements) {
      const criteria =
        requirement.acceptanceCriteria.length > 0
          ? requirement.acceptanceCriteria
          : [{ id: 'AC1', text: requirement.title }];

      const criterionCoverages: CriterionCoverage[] = [];
      for (const criterion of criteria) {
        const scored: TestEvidence[] = [];
        for (const test of tests) {
          const result = scoreTestAgainstCriterion(
            requirement,
            criterion.text,
            criterion.id,
            test,
            map
          );
          if (result) scored.push(result.evidence);
        }
        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, 5);
        const { status, score } = criterionStatus(top);
        criterionCoverages.push({
          criterionId: criterion.id,
          text: criterion.text,
          status,
          score: Number(score.toFixed(2)),
          tests: top,
        });
      }

      const covered = criterionCoverages.filter((c) => c.status === 'covered').length;
      const partial = criterionCoverages.filter((c) => c.status === 'partial').length;
      let status: CoverageState;
      if (covered === criterionCoverages.length) status = 'covered';
      else if (covered > 0 || partial > 0) status = 'partial';
      else status = 'uncovered';

      const confidence =
        criterionCoverages.reduce((sum, c) => sum + c.score, 0) /
        Math.max(1, criterionCoverages.length);

      const gaps = criterionCoverages
        .filter((c) => c.status !== 'covered')
        .map((c) => `${c.criterionId}: ${c.text}`);

      requirements.push({
        requirementId: requirement.id,
        title: requirement.title,
        priority: requirement.priority,
        status,
        confidence: Number(confidence.toFixed(2)),
        criteria: criterionCoverages,
        gaps,
        risk: riskFor(requirement.priority, status),
      });
    }

    const summary = {
      requirements: requirements.length,
      covered: requirements.filter((r) => r.status === 'covered').length,
      partial: requirements.filter((r) => r.status === 'partial').length,
      uncovered: requirements.filter((r) => r.status === 'uncovered').length,
      coveragePct: requirements.length
        ? Number(
            (
              (requirements.filter((r) => r.status === 'covered').length / requirements.length) *
              100
            ).toFixed(1)
          )
        : 0,
      highRisk: requirements.filter((r) => r.risk === 'high').length,
    };

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      scope: requirementSet.scope,
      summary,
      requirements,
    };
  }

  /**
   * Validates existing mappings against current reality. Every mapped test is
   * classified so the user knows which evidence to trust, fix, or drop.
   */
  public static reconcile(
    requirementSet: RequirementSet,
    tests: TestArtifact[],
    map: RequirementMapFile
  ): ReconcileReport {
    const requirementsById = new Map(requirementSet.requirements.map((r) => [r.id, r]));
    const testsByPath = new Map(tests.map((t) => [t.path, t]));
    const findings: ReconcileFinding[] = [];

    for (const [requirementId, entry] of Object.entries(map.requirements)) {
      const requirement = requirementsById.get(requirementId);
      for (const criterion of entry.criteria) {
        const acExists =
          requirement &&
          requirement.acceptanceCriteria.some(
            (ac) =>
              ac.text.trim().toLowerCase() === criterion.text.trim().toLowerCase() ||
              (criterion.criterionId && ac.id === criterion.criterionId)
          );

        for (const ref of criterion.tests) {
          const base = { requirementId, criterionText: criterion.text, testPath: ref.path };
          const test = testsByPath.get(ref.path);
          const fileExists = test || fs.existsSync(path.join(PROJECT_ROOT, ref.path));

          if (!requirement) {
            findings.push({
              ...base,
              status: 'orphan',
              detail: `Requirement ${requirementId} is not in the current requirement set.`,
              suggestion: 'Re-import requirements or remove this mapping.',
            });
            continue;
          }
          if (!fileExists) {
            findings.push({
              ...base,
              status: 'broken',
              detail: `Mapped test file no longer exists: ${ref.path}`,
              suggestion: 'Update the path or remove the mapping.',
            });
            continue;
          }
          if (requirement && !acExists && requirement.acceptanceCriteria.length > 0) {
            findings.push({
              ...base,
              status: 'conflict',
              detail: 'Mapped acceptance criterion no longer exists on the requirement.',
              suggestion: 'Re-map to a current acceptance criterion.',
            });
            continue;
          }

          if (test) {
            const scored = scoreTestAgainstCriterion(
              requirement,
              criterion.text,
              criterion.criterionId || '',
              test,
              { version: 1, requirements: {} } // ignore the mapping itself to judge real similarity
            );
            const score = scored?.evidence.score ?? 0;
            if (score < MATCH_THRESHOLD) {
              findings.push({
                ...base,
                status: 'stale',
                detail: `Test no longer semantically matches the criterion (score ${score}).`,
                suggestion: 'Review whether the test still covers this criterion.',
              });
              continue;
            }
            if (score < LOW_QUALITY_CEIL && criterion.status !== 'confirmed') {
              findings.push({
                ...base,
                status: 'low-quality',
                detail: `Weak match (score ${score}). Confirm or replace.`,
                suggestion: 'Confirm the mapping if correct, otherwise re-map.',
              });
              continue;
            }
          }

          findings.push({
            ...base,
            status: 'valid',
            detail: 'Mapping matches current requirement and test.',
          });
        }
      }
    }

    const summary: Record<ReconcileStatus, number> = {
      valid: 0,
      stale: 0,
      broken: 0,
      orphan: 0,
      conflict: 0,
      'low-quality': 0,
    };
    for (const f of findings) summary[f.status] += 1;

    return { version: 1, generatedAt: new Date().toISOString(), findings, summary };
  }
}
