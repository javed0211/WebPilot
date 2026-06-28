import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { CONFIG_ROOT, REQUIREMENT_MAP_PATH } from '../ProjectPaths';
import {
  MappingConfidence,
  MappingCriterionEntry,
  MappingTestRef,
  RequirementMapFile,
} from './types';

function emptyMap(): RequirementMapFile {
  return { version: 1, requirements: {} };
}

export class RequirementMap {
  public static load(): RequirementMapFile {
    if (!fs.existsSync(REQUIREMENT_MAP_PATH)) return emptyMap();
    try {
      const parsed = yaml.load(fs.readFileSync(REQUIREMENT_MAP_PATH, 'utf8')) as Partial<RequirementMapFile>;
      if (!parsed || typeof parsed !== 'object') return emptyMap();
      return {
        version: 1,
        requirements: (parsed.requirements as RequirementMapFile['requirements']) || {},
      };
    } catch {
      return emptyMap();
    }
  }

  public static save(map: RequirementMapFile): void {
    fs.mkdirSync(CONFIG_ROOT, { recursive: true });
    const header =
      '# WebPilot requirement-to-test mapping (Feature 09).\n' +
      '# Generated and reconciled by `webpilot coverage`. Edit `status: confirmed`\n' +
      '# to lock a mapping, or `rejected` to suppress a proposed mapping.\n';
    fs.writeFileSync(
      REQUIREMENT_MAP_PATH,
      header + yaml.dump(map, { lineWidth: 100, noRefs: true }),
      'utf8'
    );
  }

  public static path(): string {
    return path.relative(process.cwd(), REQUIREMENT_MAP_PATH);
  }

  /**
   * Upserts a proposed/confirmed mapping for a requirement criterion. Existing
   * confirmed/rejected entries are not downgraded by a proposal.
   */
  public static upsert(
    map: RequirementMapFile,
    requirementId: string,
    criterionText: string,
    tests: MappingTestRef[],
    status: MappingConfidence,
    criterionId?: string
  ): void {
    const entry = (map.requirements[requirementId] ||= { criteria: [] });
    const normalized = criterionText.trim().toLowerCase();
    let criterion = entry.criteria.find(
      (c) => c.text.trim().toLowerCase() === normalized || (criterionId && c.criterionId === criterionId)
    );
    if (!criterion) {
      criterion = { text: criterionText, criterionId, tests: [], status };
      entry.criteria.push(criterion);
    }
    // Do not silently overwrite a human decision with a machine proposal.
    if (status === 'proposed' && (criterion.status === 'confirmed' || criterion.status === 'rejected')) {
      return;
    }
    criterion.status = status;
    if (criterionId && !criterion.criterionId) criterion.criterionId = criterionId;

    const byPath = new Map<string, MappingTestRef>();
    for (const t of criterion.tests) byPath.set(t.path, t);
    for (const t of tests) byPath.set(t.path, t);
    criterion.tests = [...byPath.values()];
  }

  public static findCriterion(
    map: RequirementMapFile,
    requirementId: string,
    criterionText: string,
    criterionId?: string
  ): MappingCriterionEntry | undefined {
    const entry = map.requirements[requirementId];
    if (!entry) return undefined;
    const normalized = criterionText.trim().toLowerCase();
    return entry.criteria.find(
      (c) => c.text.trim().toLowerCase() === normalized || (criterionId && c.criterionId === criterionId)
    );
  }
}
