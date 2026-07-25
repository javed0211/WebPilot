import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { resolveExecutionHistoryPath } from '../ReportPaths';
import { BrowserProviderRegistry } from '../browserProviders/BrowserProviderRegistry';
import { ActHistoryReplayService } from './ActHistoryReplayService';
import type { ActReplayResult } from './ActHistoryTypes';

export type KnowledgeOnlyStrategy = 'spec' | 'act-history' | 'unavailable';

export interface KnowledgeOnlyPlan {
  strategy: KnowledgeOnlyStrategy;
  slug: string;
  specPath?: string;
  historyPath?: string;
  reason: string;
}

function defaultSpecPath(slug: string): string {
  return path.join('packages', 'test-framework', 'tests', `${slug}.spec.ts`);
}

function hasActHistory(slug: string): { ok: boolean; path: string } {
  const historyPath = resolveExecutionHistoryPath(slug);
  if (!fs.existsSync(historyPath)) return { ok: false, path: historyPath };
  try {
    const raw = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    const steps = raw.actHistory || raw.executionHistory || [];
    return { ok: Array.isArray(steps) && steps.length > 0, path: historyPath };
  } catch {
    return { ok: false, path: historyPath };
  }
}

/**
 * Prefer generated Playwright spec, else ActHistory Playwright runner.
 * JS site-knowledge execute_capability is no longer the primary path.
 */
export class KnowledgeOnlyReplay {
  public static plan(slug: string, options?: { preferSpec?: boolean }): KnowledgeOnlyPlan {
    const preferSpec = options?.preferSpec !== false;
    const specPath = defaultSpecPath(slug);
    const history = hasActHistory(slug);

    if (preferSpec && fs.existsSync(specPath)) {
      return {
        strategy: 'spec',
        slug,
        specPath,
        historyPath: history.ok ? history.path : undefined,
        reason: `Generated Playwright spec found at ${specPath}`,
      };
    }
    if (history.ok) {
      return {
        strategy: 'act-history',
        slug,
        historyPath: history.path,
        reason: `ActHistory found at ${history.path}`,
      };
    }
    return {
      strategy: 'unavailable',
      slug,
      reason:
        `No Playwright replay source for "${slug}". ` +
        `Run once with discovery (webpilot run …) to create ActHistory, ` +
        `optionally with --codegen for a generated spec. ` +
        `Legacy JS site-knowledge replay is deprecated.`,
    };
  }

  public static async run(
    slug: string,
    options?: { headed?: boolean; heal?: boolean; preferSpec?: boolean }
  ): Promise<{ success: boolean; strategy: KnowledgeOnlyStrategy; detail: string; result?: ActReplayResult }> {
    const plan = KnowledgeOnlyReplay.plan(slug, { preferSpec: options?.preferSpec });

    if (plan.strategy === 'unavailable') {
      return { success: false, strategy: plan.strategy, detail: plan.reason };
    }

    if (plan.strategy === 'spec' && plan.specPath) {
      const { resolvePlaywrightCli } = require('../PlaywrightCliPath');
      const playwrightCli = resolvePlaywrightCli();
      const headed = BrowserProviderRegistry.resolveHeaded();
      const args = [
        playwrightCli,
        'test',
        plan.specPath,
        '--config=packages/test-framework/playwright.config.ts',
        '--project=chromium',
        headed ? '--headed' : '--headless',
      ];
      const spawned = spawnSync(process.execPath, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit',
      });
      const ok = (spawned.status ?? 1) === 0;
      return {
        success: ok,
        strategy: 'spec',
        detail: ok
          ? `Spec replay passed: ${plan.specPath}`
          : `Spec replay failed: ${plan.specPath}`,
      };
    }

    const result = await ActHistoryReplayService.replay(slug, {
      heal: options?.heal,
    });
    return {
      success: result.success,
      strategy: 'act-history',
      detail: result.success
        ? `ActHistory Playwright replay passed (${result.stepsExecuted} steps)`
        : result.failure || 'ActHistory Playwright replay failed',
      result,
    };
  }
}
