import * as fs from 'fs';
import {
  REQUIREMENTS_COVERAGE_DIR,
  REQUIREMENTS_COVERAGE_PATH,
  REQUIREMENTS_GAPS_PATH,
} from '../ProjectPaths';
import { CoverageMatcher } from './CoverageMatcher';
import { RequirementMap } from './RequirementMap';
import { RequirementStore } from './RequirementStore';
import { TestInventory } from './TestInventory';
import { CoverageReport, ReconcileReport, RequirementMapFile } from './types';

export interface GenerateResult {
  coverage: CoverageReport;
  reconcile: ReconcileReport;
  proposalsWritten: number;
}

function persistCoverage(coverage: CoverageReport): void {
  fs.mkdirSync(REQUIREMENTS_COVERAGE_DIR, { recursive: true });
  fs.writeFileSync(REQUIREMENTS_COVERAGE_PATH, JSON.stringify(coverage, null, 2), 'utf8');
  const gaps = coverage.requirements
    .filter((r) => r.status !== 'covered')
    .map((r) => ({
      requirementId: r.requirementId,
      title: r.title,
      priority: r.priority,
      status: r.status,
      risk: r.risk,
      gaps: r.gaps,
    }));
  fs.writeFileSync(REQUIREMENTS_GAPS_PATH, JSON.stringify({ generatedAt: coverage.generatedAt, gaps }, null, 2), 'utf8');
}

export class CoverageService {
  /**
   * Runs the full guided-coverage pass: reconcile existing mappings, compute
   * acceptance-criterion-level coverage, and write machine proposals into the
   * mapping file for human confirmation.
   */
  public static generate(options: { writeProposals?: boolean } = {}): GenerateResult {
    const requirementSet = RequirementStore.load();
    if (!requirementSet || requirementSet.requirements.length === 0) {
      throw new Error(
        'No requirements found. Import them first: webpilot requirements import <file.json>.'
      );
    }

    const tests = TestInventory.collect();
    const map = RequirementMap.load();

    const reconcile = CoverageMatcher.reconcile(requirementSet, tests, map);
    const coverage = CoverageMatcher.buildCoverage(requirementSet, tests, map);
    persistCoverage(coverage);

    let proposalsWritten = 0;
    if (options.writeProposals !== false) {
      proposalsWritten = CoverageService.writeProposals(coverage, map);
      RequirementMap.save(map);
    }

    return { coverage, reconcile, proposalsWritten };
  }

  /** Writes `proposed` mappings for matched criteria the map does not yet cover. */
  private static writeProposals(coverage: CoverageReport, map: RequirementMapFile): number {
    let written = 0;
    for (const requirement of coverage.requirements) {
      for (const criterion of requirement.criteria) {
        if (criterion.status === 'uncovered' || criterion.tests.length === 0) continue;
        const existing = RequirementMap.findCriterion(
          map,
          requirement.requirementId,
          criterion.text,
          criterion.criterionId
        );
        if (existing && (existing.status === 'confirmed' || existing.status === 'rejected')) continue;

        const tests = criterion.tests
          .slice(0, 3)
          .map((t) => ({ path: t.path, steps: t.steps }));
        RequirementMap.upsert(
          map,
          requirement.requirementId,
          criterion.text,
          tests,
          'proposed',
          criterion.criterionId
        );
        written += 1;
      }
    }
    return written;
  }

  /** Promotes proposed mappings to confirmed (optionally for one requirement). */
  public static confirmMappings(requirementId?: string): number {
    const map = RequirementMap.load();
    let confirmed = 0;
    for (const [id, entry] of Object.entries(map.requirements)) {
      if (requirementId && id !== requirementId) continue;
      for (const criterion of entry.criteria) {
        if (criterion.status === 'proposed') {
          criterion.status = 'confirmed';
          confirmed += 1;
        }
      }
    }
    if (confirmed > 0) RequirementMap.save(map);
    return confirmed;
  }

  public static loadCoverage(): CoverageReport | null {
    if (!fs.existsSync(REQUIREMENTS_COVERAGE_PATH)) return null;
    try {
      return JSON.parse(fs.readFileSync(REQUIREMENTS_COVERAGE_PATH, 'utf8')) as CoverageReport;
    } catch {
      return null;
    }
  }
}
