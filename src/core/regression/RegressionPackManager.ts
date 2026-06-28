import * as fs from 'fs';
import * as path from 'path';
import { REGRESSION_PACKS_DIR } from '../ProjectPaths';
import { CoverageReport } from '../requirements/types';
import { TestArtifact } from '../requirements/TestInventory';

export interface RegressionPackEntry {
  path: string;
  slug: string;
  reason: string;
  /** Highest requirement priority this test serves. */
  priority?: string;
  /** 0..1 selection weight (higher = run earlier / more important). */
  weight: number;
  flakeScore: number;
  lastStatus?: string;
  requirements: string[];
}

export interface RegressionPack {
  version: 1;
  generatedAt: string;
  name: string;
  summary: {
    tests: number;
    quarantined: number;
    highPriority: number;
  };
  tests: RegressionPackEntry[];
  quarantine: { path: string; slug: string; flakeScore: number; reason: string }[];
}

const PRIORITY_WEIGHT: Record<string, number> = { P0: 1, P1: 0.8, P2: 0.55, P3: 0.3 };
const QUARANTINE_FLAKE = 0.5;

function priorityRank(priority?: string): number {
  return PRIORITY_WEIGHT[(priority || '').toUpperCase()] ?? 0.4;
}

export class RegressionPackManager {
  /**
   * Recommends a regression pack from a coverage report. Each covered/partial
   * requirement contributes its evidence tests, weighted by requirement
   * priority and risk and penalized by flakiness. Highly flaky tests are
   * quarantined rather than included in the core pack.
   */
  public static recommend(
    coverage: CoverageReport,
    tests: TestArtifact[],
    options: { name?: string; includePartial?: boolean } = {}
  ): RegressionPack {
    const includePartial = options.includePartial !== false;
    const testByPath = new Map(tests.map((t) => [t.path, t]));
    const selected = new Map<string, RegressionPackEntry>();
    const quarantine = new Map<string, RegressionPack['quarantine'][number]>();

    for (const requirement of coverage.requirements) {
      if (requirement.status === 'uncovered') continue;
      const basePriorityWeight = priorityRank(requirement.priority);
      const riskBoost = requirement.risk === 'high' ? 0.15 : requirement.risk === 'medium' ? 0.05 : 0;

      for (const criterion of requirement.criteria) {
        if (criterion.status === 'uncovered') continue;
        if (criterion.status === 'partial' && !includePartial) continue;

        for (const evidence of criterion.tests) {
          const art = testByPath.get(evidence.path);
          const flakeScore = art?.flakeScore ?? evidence.flakeScore ?? 0;
          const slug = art?.slug ?? path.basename(evidence.path, path.extname(evidence.path));

          if (flakeScore >= QUARANTINE_FLAKE) {
            if (!quarantine.has(evidence.path)) {
              quarantine.set(evidence.path, {
                path: evidence.path,
                slug,
                flakeScore,
                reason: `Flake score ${flakeScore} >= ${QUARANTINE_FLAKE}; stabilize before adding to pack.`,
              });
            }
            continue;
          }

          const weight = Number(
            Math.min(1, basePriorityWeight + riskBoost + evidence.score * 0.1 - flakeScore * 0.2).toFixed(
              2
            )
          );
          const existing = selected.get(evidence.path);
          if (existing) {
            existing.weight = Math.max(existing.weight, weight);
            if (!existing.requirements.includes(requirement.requirementId)) {
              existing.requirements.push(requirement.requirementId);
            }
            if (priorityRank(requirement.priority) > priorityRank(existing.priority)) {
              existing.priority = requirement.priority;
            }
            continue;
          }
          selected.set(evidence.path, {
            path: evidence.path,
            slug,
            reason: `Covers ${requirement.requirementId} (${requirement.risk} risk)`,
            priority: requirement.priority,
            weight,
            flakeScore,
            lastStatus: evidence.lastStatus,
            requirements: [requirement.requirementId],
          });
        }
      }
    }

    const orderedTests = [...selected.values()].sort((a, b) => b.weight - a.weight);
    const quarantineList = [...quarantine.values()].sort((a, b) => b.flakeScore - a.flakeScore);

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      name: options.name || 'default',
      summary: {
        tests: orderedTests.length,
        quarantined: quarantineList.length,
        highPriority: orderedTests.filter((t) => priorityRank(t.priority) >= 0.8).length,
      },
      tests: orderedTests,
      quarantine: quarantineList,
    };
  }

  public static save(pack: RegressionPack): string {
    fs.mkdirSync(REGRESSION_PACKS_DIR, { recursive: true });
    const file = path.join(REGRESSION_PACKS_DIR, `${pack.name}.json`);
    fs.writeFileSync(file, JSON.stringify(pack, null, 2), 'utf8');
    return file;
  }

  public static load(name: string): RegressionPack | null {
    const file = path.join(REGRESSION_PACKS_DIR, `${name}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as RegressionPack;
    } catch {
      return null;
    }
  }
}
