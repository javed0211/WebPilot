import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { estimateCostUsd } from '../../utils/ModelPricing';
import { ConfigManager } from '../ConfigManager';
import {
  hrefFromReportsHtml,
  listSummarySlugs,
  REPORTS_SCREENSHOTS_DIR,
  resolveExecutionHistoryPath,
  resolveLlmUsagePath,
  resolveSummaryPath,
} from '../ReportPaths';
import {
  ReportArtifacts,
  ReportBrowser,
  ReportEnvironment,
  ReportPricing,
  ReportStep,
  SuiteExecutionReport,
  TestCaseReport,
} from './types';
import { loadRunHistory } from './history';
import { FlakeAnalyzer } from '../flake/FlakeAnalyzer';
import { FlakeAnalysis } from '../flake/FailureSignal';
import { BrowserProviderRegistry } from '../browserProviders/BrowserProviderRegistry';

export function loadEnvConfig(envName: string): ReportEnvironment {
  const envPath = path.join(process.cwd(), 'resources', 'config', 'environments', `${envName}.json`);
  if (!fs.existsSync(envPath)) {
    return { name: envName };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(envPath, 'utf8'));
    return {
      name: raw.environment || envName,
      baseUrl: raw.baseUrl,
      apiBaseUrl: raw.apiBaseUrl,
    };
  } catch {
    return { name: envName };
  }
}

export function loadBrowserConfig(providerOverride?: ReportBrowser['provider']): ReportBrowser {
  const cm = ConfigManager.getInstance();
  const vp = cm.get('browser.viewport', { width: 1280, height: 720 });
  const provider = BrowserProviderRegistry.resolve();
  return {
    target: cm.get('browser.target', 'chrome'),
    channel: cm.get('browser.target', 'chrome'),
    headless: BrowserProviderRegistry.resolveHeadless(),
    viewport: vp,
    video: String(cm.get('browser.video', 'on')),
    trace: String(cm.get('browser.trace', 'on')),
    screenshots: String(cm.get('browser.screenshots', 'only-on-failure')),
    provider: providerOverride || provider.sessionInfo(),
  };
}

export function loadFrameworkMeta(): SuiteExecutionReport['framework'] {
  const cm = ConfigManager.getInstance();
  let version = '1.0.0';
  try {
    const ypath = path.join(process.cwd(), 'resources', 'config', 'webpilot.yaml');
    if (fs.existsSync(ypath)) {
      const y = yaml.load(fs.readFileSync(ypath, 'utf8')) as Record<string, unknown>;
      const fw = y?.framework as Record<string, unknown> | undefined;
      version = String(fw?.version ?? version);
    }
  } catch {
    /* ignore */
  }
  return {
    name: cm.get('framework.name', 'WebPilot'),
    version,
    useBrowserUse: Boolean(cm.get('framework.useBrowserUse', false)),
    activeProvider: cm.get('framework.activeProvider', 'azure'),
  };
}

export function loadLlmMeta(): { model?: string; provider?: string } {
  try {
    const llmPath = path.join(process.cwd(), 'resources', 'config', 'llm.json');
    if (!fs.existsSync(llmPath)) return {};
    const llm = JSON.parse(fs.readFileSync(llmPath, 'utf8'));
    const provider = ConfigManager.getInstance().get('framework.activeProvider', 'azure');
    const pconf = llm[provider] || {};
    return { provider, model: pconf.model || pconf.deploymentId };
  } catch {
    return {};
  }
}

function loadExecutionContext(slug: string): Record<string, unknown> | null {
  const histPath = resolveExecutionHistoryPath(slug);
  if (!fs.existsSync(histPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(histPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function collectScreenshots(
  slug: string,
  summary: Record<string, unknown>,
  screenshotsMode: string
): string[] {
  const mode = String(screenshotsMode || 'only-on-failure').toLowerCase();
  const status = String(summary.status ?? '').toUpperCase();
  if (mode === 'off' || mode === 'false' || mode === '0' || mode === 'no') {
    return [];
  }
  if (mode === 'only-on-failure' && status === 'PASSED') {
    return [];
  }

  const fromSummary = (summary.artifacts as ReportArtifacts | undefined)?.screenshots;
  if (Array.isArray(fromSummary) && fromSummary.length > 0) {
    return fromSummary.map(hrefFromReportsHtml);
  }
  const dir = path.join(REPORTS_SCREENSHOTS_DIR, slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .sort()
    .map((f) => hrefFromReportsHtml(`screenshots/${slug}/${f}`));
}

function resolveUsableVideoHref(rawPath: string | undefined): string | undefined {
  if (!rawPath) return undefined;
  const href = hrefFromReportsHtml(rawPath);
  const abs = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(path.join(process.cwd(), 'runtime', 'reports', 'html'), href);
  try {
    // Stub scavenged recordings are typically <10KB and will not play in the report.
    if (!fs.existsSync(abs) || fs.statSync(abs).size < 10_000) return undefined;
  } catch {
    return undefined;
  }
  return href;
}

function buildPricing(slug: string, summary: Record<string, unknown>): ReportPricing {
  const usagePath = resolveLlmUsagePath(slug);
  let usage: Record<string, number> = {};
  if (fs.existsSync(usagePath)) {
    try {
      usage = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    } catch {
      /* ignore */
    }
  }
  const llmMeta = loadLlmMeta();
  const promptTokens = Number(summary.promptTokens ?? usage.promptTokens ?? 0);
  const completionTokens = Number(summary.completionTokens ?? usage.completionTokens ?? 0);
  let estimatedCostUsd = Number(summary.estimatedCostUsd ?? 0);
  // `??` does not fall through when summary has an explicit 0 — common for Azure/LiteLLM misses.
  if (estimatedCostUsd <= 0) {
    estimatedCostUsd = Number(usage.estimatedCostUsd ?? 0);
  }
  if (estimatedCostUsd <= 0 && promptTokens + completionTokens > 0) {
    const model =
      (summary.model as string) ||
      llmMeta.model ||
      process.env.WEBPILOT_LLM_MODEL ||
      'gpt-4.1';
    estimatedCostUsd = estimateCostUsd(model, promptTokens, completionTokens);
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens: Number(summary.tokens ?? promptTokens + completionTokens),
    estimatedCostUsd,
    llmCalls: Number(summary.llmCalls ?? usage.llmCalls ?? 0),
    model: (summary.model as string) || llmMeta.model,
    provider: (summary.provider as string) || llmMeta.provider,
  };
}

export function collectTestCaseReport(slug: string): TestCaseReport | null {
  const summaryFile = resolveSummaryPath(slug);
  if (!fs.existsSync(summaryFile)) return null;

  const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8')) as Record<string, unknown>;
  const ctx = loadExecutionContext(slug);
  const artifactsRaw = (summary.artifacts as Record<string, string | string[]>) || {};
  const summaryBrowser = summary.browser as { provider?: ReportBrowser['provider'] } | undefined;
  const browserCfg = loadBrowserConfig(summaryBrowser?.provider);

  const executionSteps: ReportStep[] = ((ctx?.executionHistory as ReportStep[]) || []).slice(0, 80);
  const nlSteps = (ctx?.nlSteps as string[]) || [];
  const urlSequence = (ctx?.urlSequence as string[]) || [];
  const insights =
    ((ctx?.runtimeInsights as { insights?: { type?: string; message?: string }[] })?.insights) || [];

  let codegenSummary: string | string[] = '';
  if (Array.isArray(summary.summary)) {
    codegenSummary = summary.summary as string[];
  } else if (typeof summary.summary === 'string') {
    codegenSummary = summary.summary;
  }

  const codegenRaw = summary.codegen as Record<string, unknown> | undefined;
  const flakeRaw = summary.flakeAnalysis as FlakeAnalysis | undefined;
  const rootCauseRaw = summary.rootCauseAnalysis as import('./RootCauseTypes').RootCauseAnalysis | undefined;
  const codegen = codegenRaw
    ? {
        mode: String(codegenRaw.mode || 'deterministic') as 'deterministic' | 'llm' | 'auto',
        specPath: String(codegenRaw.specPath || ''),
        pageObjectPaths: Array.isArray(codegenRaw.pageObjectPaths)
          ? (codegenRaw.pageObjectPaths as string[])
          : [],
        metadataPath: String(codegenRaw.metadataPath || ''),
        tracePath: String(codegenRaw.tracePath || ''),
        planPath: String(codegenRaw.planPath || ''),
        replayCommand: String(codegenRaw.replayCommand || ''),
        validationCommand:
          typeof codegenRaw.validationCommand === 'string' ? codegenRaw.validationCommand : null,
        assertionSummary:
          typeof codegenRaw.assertionSummary === 'object' && codegenRaw.assertionSummary !== null
            ? (codegenRaw.assertionSummary as any)
            : undefined,
        generatedFiles: Array.isArray(codegenRaw.generatedFiles)
          ? (codegenRaw.generatedFiles as string[])
          : [],
      }
    : undefined;

  const failureContext =
    typeof summary.failureContext === 'string' ? summary.failureContext : undefined;
  const statusReason =
    typeof summary.statusReason === 'string'
      ? summary.statusReason
      : typeof summary.summary === 'string' && String(summary.status).toUpperCase() === 'FAILED'
        ? summary.summary
        : undefined;
  const kind =
    typeof summary.kind === 'string'
      ? summary.kind
      : Array.isArray(summary.apiSteps)
        ? 'api'
        : 'web';
  const executionMode =
    typeof summary.executionMode === 'string'
      ? summary.executionMode
      : kind === 'api'
        ? 'api'
        : undefined;

  const durationRaw =
    typeof summary.durationMs === 'number'
      ? summary.durationMs
      : typeof summary.totalDurationMs === 'number'
        ? summary.totalDurationMs
        : undefined;
  const durationMs =
    durationRaw != null && Number.isFinite(durationRaw) && durationRaw >= 0
      ? Math.round(durationRaw)
      : undefined;

  const baseReport: TestCaseReport = {
    slug,
    testName: String(summary.testName ?? ctx?.testName ?? slug),
    testFile: summary.testFile as string | undefined,
    status: String(summary.status ?? 'UNKNOWN'),
    kind,
    executionMode,
    statusReason,
    failureContext,
    timestamp: String(summary.timestamp ?? ''),
    stepsExecuted: Number(summary.stepsExecuted ?? executionSteps.length),
    durationMs,
    totalDurationMs: durationMs,
    nlSteps,
    executionSteps,
    urlSequence,
    runtimeInsights: insights,
    codegenSummary,
    codegen,
    artifacts: {
      video: resolveUsableVideoHref(
        typeof artifactsRaw.video === 'string' ? artifactsRaw.video : undefined
      ),
      trace: typeof artifactsRaw.trace === 'string' ? hrefFromReportsHtml(artifactsRaw.trace) : undefined,
      screenshots: collectScreenshots(slug, summary, browserCfg.screenshots),
      eventBundle:
        typeof artifactsRaw.eventBundle === 'string' ? artifactsRaw.eventBundle : undefined,
    },
    pricing: buildPricing(slug, summary),
    browserProvider: summaryBrowser?.provider,
    runHistory: loadRunHistory(slug),
    executionHistoryPath: summary.executionHistoryPath as string | undefined,
    isAgentSuccessful: ctx?.isSuccessful as boolean | undefined,
    isAgentDone: ctx?.isDone as boolean | undefined,
    aiAnalysis: summary.aiAnalysis as string | undefined,
    rootCauseAnalysis: rootCauseRaw,
    flakeAnalysis: flakeRaw,
    evidenceRef: typeof summary.evidenceRef === 'string' ? summary.evidenceRef : undefined,
    risk: summary.risk as TestCaseReport['risk'],
    completeness: summary.completeness as TestCaseReport['completeness'],
    healingCount:
      typeof (summary.evidence as { healingCount?: number } | undefined)?.healingCount === 'number'
        ? (summary.evidence as { healingCount: number }).healingCount
        : undefined,
    codegenQuality:
      (summary.evidence as { codegenQuality?: 'good' | 'degraded' } | undefined)?.codegenQuality ||
      undefined,
  };

  // Reload detailed evidence surfaces from the bundle when regenerating reports.
  const evidenceRef =
    typeof summary.evidenceRef === 'string'
      ? summary.evidenceRef
      : typeof artifactsRaw.evidenceBundle === 'string'
        ? artifactsRaw.evidenceBundle
        : undefined;
  if (evidenceRef) {
    try {
      const abs = path.isAbsolute(evidenceRef)
        ? evidenceRef
        : path.join(process.cwd(), evidenceRef);
      if (fs.existsSync(abs)) {
        const bundle = JSON.parse(fs.readFileSync(abs, 'utf8')) as {
          timeline?: TestCaseReport['evidenceTimeline'];
          healing?: { records?: TestCaseReport['evidenceHealing']; count?: number };
          locators?: TestCaseReport['evidenceLocators'];
          pageInventory?: { drift?: TestCaseReport['evidenceDrift'] };
          risk?: TestCaseReport['risk'];
          completeness?: TestCaseReport['completeness'];
          codegen?: { quality?: 'good' | 'degraded' };
          artifacts?: { evidenceBundle?: string };
        };
        baseReport.evidenceTimeline = bundle.timeline;
        baseReport.evidenceHealing = bundle.healing?.records;
        baseReport.evidenceLocators = bundle.locators;
        baseReport.evidenceDrift = bundle.pageInventory?.drift;
        if (!baseReport.risk && bundle.risk) baseReport.risk = bundle.risk;
        if (!baseReport.completeness && bundle.completeness) {
          baseReport.completeness = bundle.completeness;
        }
        if (baseReport.healingCount == null && typeof bundle.healing?.count === 'number') {
          baseReport.healingCount = bundle.healing.count;
        }
        if (!baseReport.codegenQuality && bundle.codegen?.quality) {
          baseReport.codegenQuality = bundle.codegen.quality;
        }
        if (!baseReport.evidenceRef) {
          baseReport.evidenceRef =
            bundle.artifacts?.evidenceBundle || evidenceRef;
        }
      }
    } catch {
      /* evidence reload is best-effort */
    }
  }

  if (!baseReport.flakeAnalysis && baseReport.status !== 'PASSED') {
    baseReport.flakeAnalysis =
      FlakeAnalyzer.analyzeTestCase(baseReport, failureContext) || undefined;
  }

  return baseReport;
}

export function collectSuiteReport(options: {
  suiteName?: string;
  env?: string;
  testSlugs?: string[];
}): SuiteExecutionReport {
  const envName = options.env || ConfigManager.getInstance().get('framework.defaultEnvironment', 'qa');

  const slugs = options.testSlugs?.length ? options.testSlugs : listSummarySlugs();

  const testCases = slugs
    .map((s) => collectTestCaseReport(s))
    .filter((t): t is TestCaseReport => t !== null)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  const passed = testCases.filter((t) => t.status === 'PASSED').length;
  const failed = testCases.length - passed;
  const allRuns = testCases.flatMap((testCase) => testCase.runHistory);
  const totalDurationMs = testCases.reduce(
    (n, t) => n + (t.durationMs || t.totalDurationMs || 0),
    0
  );

  return {
    generatedAt: new Date().toISOString(),
    suiteName: options.suiteName || 'WebPilot Execution Suite',
    environment: loadEnvConfig(envName),
    browser: loadBrowserConfig(testCases[0]?.browserProvider),
    framework: loadFrameworkMeta(),
    testCases,
    overview: {
      total: testCases.length,
      passed,
      failed,
      passRate: testCases.length ? (passed / testCases.length) * 100 : 0,
      totalSteps: testCases.reduce((n, t) => n + t.stepsExecuted, 0),
      totalCostUsd: testCases.reduce((n, t) => n + t.pricing.estimatedCostUsd, 0),
      totalTokens: testCases.reduce((n, t) => n + t.pricing.totalTokens, 0),
      totalDurationMs: totalDurationMs > 0 ? totalDurationMs : undefined,
    },
    historyOverview: {
      totalRuns: allRuns.length,
      promptTokens: allRuns.reduce((n, run) => n + run.pricing.promptTokens, 0),
      completionTokens: allRuns.reduce((n, run) => n + run.pricing.completionTokens, 0),
      totalTokens: allRuns.reduce((n, run) => n + run.pricing.totalTokens, 0),
      totalCostUsd: allRuns.reduce((n, run) => n + run.pricing.estimatedCostUsd, 0),
      llmCalls: allRuns.reduce((n, run) => n + run.pricing.llmCalls, 0),
    },
    totalDurationMs: totalDurationMs > 0 ? totalDurationMs : undefined,
  };
}
