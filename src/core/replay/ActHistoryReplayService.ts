import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../ConfigManager';
import { BrowserProviderRegistry } from '../browserProviders/BrowserProviderRegistry';
import { LLMClient } from '../LLMClient';
import {
  REPORTS_VIDEOS_DIR,
  resolveExecutionHistoryPath,
  resolveSummaryPath,
} from '../ReportPaths';
import { generateExecutionReports } from '../ExecutionReportService';
import { HealingAgent } from '../../agents/HealingAgent';
import { ExecutionEventLedger } from '../events/ExecutionEventLedger';
import { eventBundlePath, replayStepResultsPath } from '../events/EventPaths';
import { resolveFeatureFlags } from '../lifecycle/FeatureFlags';
import {
  ActHistoryPlaywrightRunner,
  type ActReplayHealHook,
} from './ActHistoryPlaywrightRunner';
import type {
  ActHealingRecord,
  ActHistoryDocument,
  ActReplayResult,
  ActRunLog,
} from './ActHistoryTypes';

export interface ReplayFromHistoryOptions {
  /** @deprecated Ignored — headless comes from webpilot.yaml only. */
  headed?: boolean;
  heal?: boolean;
  stepTimeoutMs?: number;
  /** Override browser.video for this replay (Playwright .webm only — never ffmpeg). */
  video?: 'off' | 'on' | 'retain-on-failure';
}

function loadDocument(slug: string): ActHistoryDocument {
  const historyPath = resolveExecutionHistoryPath(slug);
  if (!fs.existsSync(historyPath)) {
    throw new Error(
      `No ActHistory found for "${slug}". Expected: ${historyPath}. Run the scenario with the WebPilot agent first.`
    );
  }
  const raw = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as ActHistoryDocument;
  const steps = raw.actHistory?.length ? raw.actHistory : raw.executionHistory || [];
  const compactSteps = raw.compactWorkflow?.steps?.length || 0;
  if (!steps.length && !compactSteps) {
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

  // Default matches resources/config/webpilot.yaml (Playwright .webm evidence).
  const raw = String(cm.get('browser.video', 'on') || 'on').toLowerCase();
  if (raw === 'off' || raw === 'false' || raw === '0' || raw === 'no') return 'off';
  if (raw === 'retain-on-failure') return 'retain-on-failure';
  if (raw === 'on' || raw === 'true' || raw === '1' || raw === 'yes') return 'on';
  return 'on';
}

function resolveScreenshotMode(cm: ConfigManager): 'off' | 'on' | 'only-on-failure' {
  const raw = String(cm.get('browser.screenshots', 'only-on-failure') || 'only-on-failure').toLowerCase();
  if (raw === 'off' || raw === 'on' || raw === 'only-on-failure') return raw;
  return 'only-on-failure';
}

function persistReplayStepResults(
  slug: string,
  runId: string,
  result: ActReplayResult
): string | undefined {
  try {
    const outPath = replayStepResultsPath(slug, runId);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          runId,
          slug,
          success: result.success,
          stepsExecuted: result.stepsExecuted,
          healedCount: result.healedCount,
          failure: result.failure,
          stepResults: result.stepResults,
          videoPath: result.videoPath,
          screenshotPaths: result.screenshotPaths,
          persistedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );
    return outPath;
  } catch (err) {
    console.warn(
      `Warning: could not persist replay step results for ${slug}:`,
      err instanceof Error ? err.message : err
    );
    return undefined;
  }
}

function persistReplayArtifacts(
  slug: string,
  result: ActReplayResult,
  extras?: { eventBundlePath?: string; stepResultsPath?: string; runId?: string }
): void {
  const summaryPath = resolveSummaryPath(slug);
  if (!fs.existsSync(summaryPath)) return;

  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as Record<string, unknown>;
    const artifacts = { ...((summary.artifacts as Record<string, unknown>) || {}) };

    if (result.videoPath && fs.existsSync(result.videoPath) && fs.statSync(result.videoPath).size >= 2_000) {
      artifacts.video = result.videoPath;
    } else {
      delete artifacts.video;
      // Remove stale stub if present under the canonical name.
      for (const ext of ['.webm', '.mp4']) {
        const stale = path.join(REPORTS_VIDEOS_DIR, `${slug}${ext}`);
        try {
          if (fs.existsSync(stale) && fs.statSync(stale).size < 2_000) fs.unlinkSync(stale);
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

    if (extras?.eventBundlePath) artifacts.eventBundle = extras.eventBundlePath;
    if (extras?.stepResultsPath) artifacts.stepResults = extras.stepResultsPath;

    summary.artifacts = artifacts;
    // Preserve an existing pipeline statusReason (e.g. codegen failure) — replay
    // artifacts must not silently flip an overall FAILED into PASSED.
    const priorReason = typeof summary.statusReason === 'string' ? summary.statusReason : '';
    const priorFailed =
      String(summary.status || '').toUpperCase() === 'FAILED' &&
      /codegen|validation/i.test(priorReason);
    if (!priorFailed) {
      summary.status = result.success ? 'PASSED' : 'FAILED';
    }
    summary.executionMode =
      typeof summary.executionMode === 'string' ? summary.executionMode : 'act-history-replay';
    summary.stepsExecuted = result.stepsExecuted;
    summary.timestamp = new Date().toISOString();
    if (typeof summary.durationMs !== 'number' && typeof result.durationMs === 'number') {
      summary.durationMs = result.durationMs;
    }
    if (extras?.runId) summary.runId = extras.runId;
    if (!result.success && result.failure) {
      summary.failureContext = result.failure;
      if (!summary.statusReason) {
        summary.statusReason = `ActHistory replay failed: ${result.failure}`;
      }
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
 *
 * Strict --no-heal: no HealingAgent, no healing-cache write, no inventory heal upsert.
 * Successful locators still upsert live-verified inventory (replay trust gate).
 */
export class ActHistoryReplayService {
  public static async replay(
    slug: string,
    options: ReplayFromHistoryOptions = {}
  ): Promise<ActReplayResult> {
    const doc = loadDocument(slug);
    const runner = new ActHistoryPlaywrightRunner();
    const cm = ConfigManager.getInstance();
    const healEnabled = Boolean(options.heal);
    const flags = resolveFeatureFlags(cm);

    const ledger = flags.eventLedger
      ? new ExecutionEventLedger({ scenarioId: slug, source: 'replay' })
      : null;
    ledger?.appendLifecycle('replay.started', 'started', { heal: healEnabled });

    let healHook: ActReplayHealHook | null = null;
    let healer: HealingAgent | null = null;
    if (healEnabled) {
      const llm = new LLMClient();
      healer = new HealingAgent(
        llm,
        cm.get('framework.healingCachePath', './runtime/healing-cache/cache.json')
      );
      healHook = async ({ page, step, brokenDescription }) => {
        const state = await ActHistoryPlaywrightRunner.pageStateForHeal(page);
        // Always propose — cache/inventory commit happens after post-action classification.
        const result = await healer!.propose(brokenDescription, state as any, step.action);
        if (!result.healedSelector || result.confidence < 0.6) return null;
        const proposeEvent = ledger?.append({
          kind: 'healing',
          phase: 'execute',
          outcome: 'info',
          stepIndex: step.index,
          payload: {
            event: 'heal.proposed',
            brokenSelector: brokenDescription,
            healedSelector: result.healedSelector,
            confidence: result.confidence,
            reasoning: result.reasoning,
            proposalPath: result.proposalPath,
            commitPolicy: flags.healingCommitPolicy,
            classificationMode: flags.healingClassification,
          },
        });
        return {
          healedSelector: result.healedSelector,
          confidence: result.confidence,
          reasoning: result.reasoning,
          proposalPath: result.proposalPath,
          proposeSequence: proposeEvent?.sequence,
        };
      };
    }

    const headed = BrowserProviderRegistry.resolveHeaded();
    let result: ActReplayResult;
    let healing: ActHealingRecord[] = [];
    const replayStartedAt = Date.now();
    try {
      const run = await runner.run(slug, doc, {
        headed,
        stepTimeoutMs: options.stepTimeoutMs,
        heal: healHook,
        video: options.video ?? resolveVideoMode(cm),
        screenshots: resolveScreenshotMode(cm),
        eventLedger: ledger || undefined,
        healCommit: healer
          ? {
              saveToCache: (broken, healedSel) => healer!.saveToCache(broken, healedSel),
              upsertInventory: (healedSel, url) => {
                try {
                  const { upsertLiveVerifiedLocator, verifiedLocatorFromHealedSelector } =
                    require('./PageInventory') as typeof import('./PageInventory');
                  const verified = verifiedLocatorFromHealedSelector(healedSel);
                  if (!verified || !url) return;
                  upsertLiveVerifiedLocator(
                    url,
                    {
                      kind: verified.kind as any,
                      value: verified.value,
                      name: verified.name,
                      exact: verified.exact,
                    },
                    verified.name || null
                  );
                } catch (err) {
                  console.warn(
                    '  Warning: page inventory upsert after classified heal failed:',
                    err instanceof Error ? err.message : err
                  );
                }
              },
            }
          : undefined,
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
      result = { ...run.result, durationMs: Date.now() - replayStartedAt };
      healing = run.healing;
    } catch (err) {
      ledger?.appendLifecycle('replay.crashed', 'failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      ledger?.finalize();
      throw err;
    }

    // Strict --no-heal: never persist healing records or cache side-effects.
    if (healEnabled && healing.length) {
      persistHealing(slug, doc, {
        healing,
        failures: result.success ? [] : [result.failure || 'replay failed'],
      });
    } else if (!result.success) {
      persistHealing(slug, doc, {
        failures: [result.failure || 'replay failed'],
      });
    }

    let stepResultsPath: string | undefined;
    let bundlePath: string | undefined;
    if (ledger) {
      ledger.appendLifecycle('replay.finished', result.success ? 'passed' : 'failed', {
        stepsExecuted: result.stepsExecuted,
        healedCount: result.healedCount,
        failure: result.failure,
      });
      const bundle = ledger.finalize();
      bundlePath = eventBundlePath(slug, bundle.header.runId);
      stepResultsPath = persistReplayStepResults(slug, bundle.header.runId, result);
      persistReplayArtifacts(slug, result, {
        eventBundlePath: bundlePath,
        stepResultsPath,
        runId: bundle.header.runId,
      });
    } else {
      persistReplayArtifacts(slug, result);
    }
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
    if (bundlePath) {
      console.log(`  Event ledger: ${bundlePath}`);
    }

    try {
      const { AdoResultPublisher } = require('../integrations/ado/AdoResultPublisher');
      await AdoResultPublisher.maybeAutoPublish(slug, false);
    } catch (adoErr) {
      console.warn(
        `Warning: ADO auto-publish skipped:`,
        adoErr instanceof Error ? adoErr.message : adoErr
      );
    }

    return result;
  }
}
