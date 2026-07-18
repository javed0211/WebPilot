import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ADO_TEST_MAP_PATH, PROJECT_ROOT } from '../../core/ProjectPaths';
import { AdoTestMapEntry, AdoTestMapFile } from './types';

const EMPTY_MAP: AdoTestMapFile = { version: 1, tests: {} };

function normalizeRel(testPath: string): string {
  const abs = path.isAbsolute(testPath) ? testPath : path.join(PROJECT_ROOT, testPath);
  return path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
}

export class AdoTestMap {
  public static path(): string {
    return ADO_TEST_MAP_PATH;
  }

  public static load(): AdoTestMapFile {
    if (!fs.existsSync(ADO_TEST_MAP_PATH)) return { ...EMPTY_MAP, tests: {} };
    try {
      const raw = yaml.load(fs.readFileSync(ADO_TEST_MAP_PATH, 'utf8')) as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object') return { ...EMPTY_MAP, tests: {} };
      const tests: Record<string, AdoTestMapEntry> = {};
      const nested = raw.tests;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
          if (value && typeof value === 'object' && 'testCaseId' in value) {
            tests[key] = value as AdoTestMapEntry;
          }
        }
      }
      // Support flat map shape from the plan example (path keys at top level).
      if (Object.keys(tests).length === 0) {
        for (const [key, value] of Object.entries(raw)) {
          if (key === 'version' || key === 'tests') continue;
          if (value && typeof value === 'object' && 'testCaseId' in value) {
            tests[key] = value as AdoTestMapEntry;
          }
        }
      }
      return { version: 1, tests };
    } catch (err) {
      throw new Error(
        `Failed to parse ${ADO_TEST_MAP_PATH}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  public static save(map: AdoTestMapFile): void {
    fs.mkdirSync(path.dirname(ADO_TEST_MAP_PATH), { recursive: true });
    const doc = {
      version: 1 as const,
      tests: map.tests,
    };
    fs.writeFileSync(
      ADO_TEST_MAP_PATH,
      `# WebPilot ↔ Azure DevOps Test Case map\n# Keys are repo-relative test paths.\n${yaml.dump(doc, {
        lineWidth: 120,
        noRefs: true,
      })}`,
      'utf8'
    );
  }

  public static get(testPath: string): AdoTestMapEntry | undefined {
    const map = this.load();
    return map.tests[normalizeRel(testPath)];
  }

  public static upsert(testPath: string, entry: AdoTestMapEntry): AdoTestMapFile {
    const map = this.load();
    map.tests[normalizeRel(testPath)] = entry;
    this.save(map);
    return map;
  }

  public static list(): Array<{ path: string; entry: AdoTestMapEntry }> {
    const map = this.load();
    return Object.entries(map.tests).map(([p, entry]) => ({ path: p, entry }));
  }

  public static findByTestCaseId(testCaseId: number): { path: string; entry: AdoTestMapEntry } | undefined {
    return this.list().find((row) => row.entry.testCaseId === testCaseId);
  }
}
