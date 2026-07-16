import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../ConfigManager';
import { LLMClient } from '../LLMClient';
import {
  REPORTS_VIDEOS_DIR,
  resolveExecutionHistoryPath,
  resolveSummaryPath,
} from '../ReportPaths';
import { generateExecutionReports } from '../ExecutionReportService';
import { HealingAgent } from '../../agents/HealingAgent';
import {
  ActHistoryPlaywrightRunner,
  type ActReplayHealHook,
} from './ActHistoryPlaywrightRunner';
import type {
  ActHistoryDocument,
  ActReplayResult,
  ActRunLog,
} from './ActHistoryTypes';

export interface ReplayFromHistoryOptions {
  headed?: boolean;
  heal?: boolean;
  stepTimeoutMs?: number;
}

function loadDocument(slug: string): ActHistoryDocument {
  const historyPath = resolveExecutionHistoryPath(slug);
  if (!fs.existsSync(historyPath)) {
    throw new Error(
      `No ActHistory found for "${slug}". Expected: ${historyPath}. Run the scenario with browser-use first.`
    );
  }
  const raw = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as ActHistoryDocument;
  const steps = raw.actHistory?.length ? raw.actHistory : raw.executionHistory || [];
  if (!steps.length) {
    throw new Error(`ActHistory for "${slug}" has no steps to replay.`);
  }
  return raw;
}

function persistHealing(slug: string, doc: ActHistoryDocument, runLogPatch: Partial<ActRunLog>): void {
  const historyPath = resolveExecutionHistoryPath(slug);
  // Never demote a successful discovery history because a later replay/heal failed.
  // Replay failures belong in the summary/report — rediscovery is only warranted when
  // discovery itself was not successful.
  const preserveDiscoverySuccess = doc.isSuccessful === true;
  const next: ActHistoryDocument = {
    ...doc,
    isSuccessful: preserveDiscoverySuccess ? true : doc.isSuccessful,
    runLog: {
      ...(doc.runLog || {}),
      ...runLogPatch,
      healing: [...(doc.runLog?.healing || []), ...(runLogPatch.healing || [])],
      failures: preserveDiscoverySuccess ? [] : runLogPatch.failures ?? doc.runLog?.failures ?? [],
      isSuccessful: preserveDiscoverySuccess ? true : runLogPatch.isSuccessful ?? doc.runLog?.isSuccessful,
    },
  };
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, JSON.stringify(next, null, 2), 'utf8');
}

function resolveVideoMode(cm: ConfigManager): 'off' | 'on' | 'retain-on-failure' {
  const env = String(process.env.WEBPILOT_VIDEO || '').trim().toLowerCase();
  if (env === 'off' || env === '0' || env === 'false' || env === 'no') return 'off';
  if (env === 'on' || env === '1' || env === 'true' || env === 'yes') return 'on';
  if (env === 'retain-on-failure') return 'retain-on-failure';

  const raw = String(cm.get('browser.video', 'off') || 'off').toLowerCase();
  if (raw === 'on' || raw === 'true' || raw === '1' || raw === 'yes') return 'on';
  if (raw === 'retain-on-failure') return 'retain-on-failure';
  // yaml `off` disables BA ffmpeg screencast only; Playwright ActHistory still
  // records on failure (matches playwright.config.ts retain-on-failure).
  return 'retain-on-failure';
}

function resolveScreenshotMode(cm: ConfigManager): 'off' | 'on' | 'only-on-failure' {
  const raw = String(cm.get('browser.screenshots', 'only-on-failure') || 'only-on-failure').toLowerCase();
  if (raw === 'off' || raw === 'on' || raw === 'only-on-failure') return raw;
  return 'only-on-failure';
}

function persistReplayArtifacts(slug: string, result: ActReplayResult): void {
  const summaryPath = resolveSummaryPath(slug);
  if (!fs.existsSync(summaryPath)) return;

  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as Record<string, unknown>;
    const artifacts = { ...((summary.artifacts as Record<string, unknown>) || {}) };

    if (result.videoPath && fs.existsSync(result.videoPath) && fs.statSync(result.videoPath).size >= 10_000) {
      artifacts.video = result.videoPath;
    } else {
      delete artifacts.video;
      // Remove stale stub if present under the canonical name.
      for (const ext of ['.webm', '.mp4']) {
        const stale = path.join(REPORTS_VIDEOS_DIR, `${slug}${ext}`);
        try {
          if (fs.existsSync(stale) && fs.statSync(stale).size < 10_000) fs.unlinkSync(stale);
        } catch {
          // ignore
        }
      }
    }

    if (result.screenshotPaths?.length) {
      artifacts.screenshots = result.screenshotPaths;
    } else if (result.success) {
      artifacts.screenshots = [];
    }

    summary.artifacts = artifacts;
    summary.status = result.success ? 'PASSED' : 'FAILED';
    summary.stepsExecuted = result.stepsExecuted;
    summary.timestamp = new Date().toISOString();
    if (!result.success && result.failure) {
      summary.failureContext = result.failure;
    }
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  } catch (err) {
    console.warn(
      `Warning: could not update summary artifacts for ${slug}:`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Replay saved ActHistory via Playwright (no browser-use, no discovery).
 * LLM is used when heal is enabled (default on) and a locator fails after fallbacks.
 * Disable with --no-heal or WEBPILOT_REPLAY_HEAL=0.
 */
export class ActHistoryReplayService {
  public static async replay(
    slug: string,
    options: ReplayFromHistoryOptions = {}
  ): Promise<ActReplayResult> {
    const doc = loadDocument(slug);
    const runner = new ActHistoryPlaywrightRunner();
    const cm = ConfigManager.getInstance();

    let healHook: ActReplayHealHook | null = null;
    if (options.heal) {
      const llm = new LLMClient();
      const healer = new HealingAgent(
        llm,
        cm.get('framework.healingCachePath', './runtime/healing-cache/cache.json')
      );
      healHook = async ({ page, step, brokenDescription }) => {
        const state = await ActHistoryPlaywrightRunner.pageStateForHeal(page);
        const result = await healer.heal(brokenDescription, state as any, step.action);
        if (!result.healedSelector || result.confidence < 0.6) return null;
        return result;
      };
    }

    const { result, healing } = await runner.run(slug, doc, {
      headed: options.headed,
      stepTimeoutMs: options.stepTimeoutMs,
      heal: healHook,
      video: resolveVideoMode(cm),
      screenshots: resolveScreenshotMode(cm),
      onStep: (stepResult) => {
        const mark = stepResult.ok ? 'ok' : 'FAIL';
        const healMark = stepResult.healed ? ' (healed)' : '';
        console.log(
          `  [${mark}] #${stepResult.index} ${stepResult.action}${healMark}` +
            (stepResult.locatorUsed ? ` — ${stepResult.locatorUsed}` : '') +
            (stepResult.error ? ` — ${stepResult.error}` : '')
        );
      },
    });

    if (healing.length) {
      persistHealing(slug, doc, {
        healing,
        failures: result.success ? [] : [result.failure || 'replay failed'],
      });
    } else if (!result.success) {
      persistHealing(slug, doc, {
        failures: [result.failure || 'replay failed'],
      });
    }

    persistReplayArtifacts(slug, result);
    try {
      await generateExecutionReports({
        testSlugs: [slug],
        skipAi: true,
        suiteName: `WebPilot — ${slug}`,
      });
    } catch (err) {
      console.warn(
        `Warning: HTML report refresh skipped:`,
        err instanceof Error ? err.message : err
      );
    }

    if (result.videoPath) {
      console.log(`  Video: ${result.videoPath}`);
    }
    if (result.screenshotPaths?.length) {
      console.log(`  Failure screenshots: ${result.screenshotPaths.length}`);
    }

    return result;
  }
}
