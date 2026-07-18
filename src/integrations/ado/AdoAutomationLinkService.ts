import * as path from 'path';
import { TestInventory } from '../../core/requirements/TestInventory';
import { PROJECT_ROOT } from '../../core/ProjectPaths';
import { AdoRestClient } from './AdoRestClient';
import { AdoTestMap } from './AdoTestMap';
import { AdoTestPlanService } from './AdoTestPlanService';
import { loadAdoConfig } from './AdoConfig';
import { AdoConfig, AdoTestMapEntry } from './types';

function stepsToAdoFormat(steps: Array<{ index: number; text: string }>): string | undefined {
  if (!steps.length) return undefined;
  return steps.map((s) => `${s.index}. ${s.text}|Expected: step completes successfully`).join('\n');
}

function automatedNameFor(testPath: string, title?: string): string {
  if (title?.trim()) return title.trim().replace(/\s+/g, '_').slice(0, 120);
  return path.basename(testPath, path.extname(testPath));
}

export interface LinkOptions {
  testPath: string;
  testCaseId: number;
  testPlanId?: number;
  testSuiteId?: number;
  title?: string;
  /** Push AutomatedTest* fields to the ADO Test Case work item. */
  pushAutomationFields?: boolean;
  dryRun?: boolean;
}

export interface SyncCasesOptions {
  fromDir?: string;
  planId: number;
  suiteId: number;
  createMissing?: boolean;
  dryRun?: boolean;
}

export class AdoAutomationLinkService {
  public constructor(private readonly config: AdoConfig = loadAdoConfig()) {}

  public async link(options: LinkOptions): Promise<AdoTestMapEntry> {
    const inventory = TestInventory.collect().find(
      (t) => t.path === options.testPath || t.path.endsWith(options.testPath)
    );
    const automatedTestName =
      automatedNameFor(options.testPath, options.title || inventory?.title);
    const entry: AdoTestMapEntry = {
      testCaseId: options.testCaseId,
      testPlanId: options.testPlanId,
      testSuiteId: options.testSuiteId,
      automatedTestName,
      title: options.title || inventory?.title,
    };

    if (options.dryRun) return entry;

    AdoTestMap.upsert(options.testPath, entry);

    if (options.pushAutomationFields !== false) {
      const rest = new AdoRestClient(this.config);
      await rest.patchWorkItem(options.testCaseId, [
        {
          op: 'add',
          path: '/fields/Microsoft.VSTS.TCM.AutomatedTestName',
          value: automatedTestName,
        },
        {
          op: 'add',
          path: '/fields/Microsoft.VSTS.TCM.AutomatedTestStorage',
          value: options.testPath.replace(/\\/g, '/'),
        },
        {
          op: 'add',
          path: '/fields/Microsoft.VSTS.TCM.AutomatedTestType',
          value: 'WebPilot',
        },
      ]);
    }

    return entry;
  }

  /**
   * For each local .txt test under fromDir (default tests/), create an ADO
   * Test Case when not already mapped, add it to the suite, and write the map.
   */
  public async syncCases(options: SyncCasesOptions): Promise<{
    linked: number;
    created: number;
    skipped: number;
    entries: Array<{ path: string; entry: AdoTestMapEntry; created: boolean }>;
    dryRun: boolean;
  }> {
    const fromDir = (options.fromDir || 'tests').replace(/\\/g, '/');
    const tests = TestInventory.collect().filter((t) => {
      const normalizedFrom = fromDir.replace(/\/$/, '');
      return t.path === normalizedFrom || t.path.startsWith(normalizedFrom + '/');
    });
    const planSvc = new AdoTestPlanService(this.config);
    const results: Array<{ path: string; entry: AdoTestMapEntry; created: boolean }> = [];
    let linked = 0;
    let created = 0;
    let skipped = 0;

    for (const test of tests) {
      const existing = AdoTestMap.get(test.path);
      if (existing) {
        skipped += 1;
        results.push({ path: test.path, entry: existing, created: false });
        continue;
      }

      if (options.createMissing === false) {
        skipped += 1;
        continue;
      }

      const title = test.title || path.basename(test.path);
      const steps = stepsToAdoFormat(test.steps);
      if (options.dryRun) {
        const entry: AdoTestMapEntry = {
          testCaseId: 0,
          testPlanId: options.planId,
          testSuiteId: options.suiteId,
          automatedTestName: automatedNameFor(test.path, title),
          title,
        };
        results.push({ path: test.path, entry, created: true });
        created += 1;
        continue;
      }

      const createdCase = await planSvc.createTestCase({
        title,
        steps,
        planId: options.planId,
        suiteId: options.suiteId,
      });
      if (!createdCase.id) {
        throw new Error(`Failed to create ADO Test Case for ${test.path}`);
      }

      const entry = await this.link({
        testPath: test.path,
        testCaseId: createdCase.id,
        testPlanId: options.planId,
        testSuiteId: options.suiteId,
        title,
        pushAutomationFields: true,
      });
      results.push({ path: test.path, entry, created: true });
      created += 1;
      linked += 1;
    }

    return { linked, created, skipped, entries: results, dryRun: Boolean(options.dryRun) };
  }

  public resolveProjectRelative(testPath: string): string {
    return path.isAbsolute(testPath)
      ? path.relative(PROJECT_ROOT, testPath).replace(/\\/g, '/')
      : testPath.replace(/\\/g, '/');
  }
}
