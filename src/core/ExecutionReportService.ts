import * as fs from 'fs';
import * as path from 'path';
import { LLMClient } from './LLMClient';
import { PromptLoader } from './PromptLoader';
import { findCliInstallRoot } from '../cli/ProjectContext';
import { collectSuiteReport } from './execution_report/collector';
import { FlakeAnalyzer } from './flake/FlakeAnalyzer';
import { renderSuiteHtml, renderTestHtml } from './execution_report/renderHtml';
import { renderReactSuiteHtml, renderReactTestHtml } from './execution_report/renderReactReport';
import { SuiteExecutionReport, TestCaseReport } from './execution_report/types';
import { RootCauseAnalyzer } from './execution_report/RootCauseAnalyzer';
import type { RootCauseAnalysis } from './execution_report/RootCauseTypes';
import { archiveCurrentRun } from './execution_report/history';
import {
  ensureReportDirs,
  listSummarySlugs,
  REPORTS_ASSETS_DIR,
  resolveSummaryPath,
  suiteIndexHtmlPath,
  summaryPath as summaryFilePath,
  testReportHtmlPath,
} from './ReportPaths';
import { UsageTracker } from '../utils/UsageTracker';
import { persistJobUsage } from '../utils/UsagePersistence';
import { resolveFeatureFlags } from './lifecycle/FeatureFlags';
import { eventBundlePath } from './events/EventPaths';
import { EvidenceBundleBuilder } from './evidence/EvidenceBundleBuilder';
import { resolveEvidenceConfig } from './evidence/EvidenceConfig';

function ensureReportAssets(): void {
  fs.mkdirSync(REPORTS_ASSETS_DIR, { recursive: true });

  for (const fileName of ['webpilot-logo-light.png', 'webpilot-logo-dark.png']) {
    const dest = path.join(REPORTS_ASSETS_DIR, fileName);
    const candidates = [
      path.join(process.cwd(), 'resources', 'assets', fileName),
      path.join(findCliInstallRoot(), 'resources', 'assets', fileName),
      path.join(REPORTS_ASSETS_DIR, fileName),
    ];
    for (const src of candidates) {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        break;
      }
    }
  }
}

export interface GenerateReportOptions {
  suiteName?: string;
  env?: string;
  testSlugs?: string[];
  testFilePath?: string;
  /** Wall-clock suite duration (ms). Preferred for overview Total time. */
  durationMs?: number;
  /** Per-test wall-clock durations keyed by slug. */
  testDurations?: Record<string, number>;
  skipAi?: boolean;
}

export interface GenerateReportResult {
  suiteHtmlPath: string;
  testHtmlPaths: string[];
}

function enrichSummaryMeta(
  slug: string,
  meta: { env?: string; testFilePath?: string; durationMs?: number }
): void {
  const readPath = resolveSummaryPath(slug);
  if (!fs.existsSync(readPath)) return;
  try {
    const summary = JSON.parse(fs.readFileSync(readPath, 'utf8')) as Record<string, unknown>;
    if (meta.env) summary.environment = meta.env;
    if (meta.testFilePath) summary.testFile = meta.testFilePath;
    if (meta.durationMs != null) summary.durationMs = meta.durationMs;
    fs.mkdirSync(path.dirname(summaryFilePath(slug)), { recursive: true });
    fs.writeFileSync(summaryFilePath(slug), JSON.stringify(summary, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

function buildTestAiPayload(t: TestCaseReport): Record<string, string> {
  const kind = String(t.kind || (t.executionMode === 'api' ? 'api' : 'web')).toLowerCase();
  const sample = (t.evidenceTimeline?.length ? t.evidenceTimeline : t.executionSteps)
    .slice(0, 15)
    .map((s: any) => {
      if (s.httpMethod || kind === 'api') {
        return `${s.index ?? ''}. [${(s.httpMethod || s.action || 'request').toUpperCase()}] ${s.url || ''} → HTTP ${s.httpStatus ?? '—'} expected ${s.expectedStatus ?? '—'} — ${(s.failureReason || s.error || s.nlStep || s.description || '').toString().slice(0, 160)}`;
      }
      return `${s.index}. [${s.action}] ${s.url || s.selector || ''} — ${(s.description || s.nlStep || s.error || '').toString().slice(0, 120)}`;
    })
    .join('\n');

  const insights = t.runtimeInsights.map((i) => `- [${i.type}] ${i.message}`).join('\n') || 'None';
  const nl = t.nlSteps.map((s, i) => `${i + 1}. ${s}`).join('\n') || 'None';
  const codegen = Array.isArray(t.codegenSummary)
    ? t.codegenSummary.join('\n')
    : String(t.codegenSummary || '');

  return {
    test_slug: t.slug,
    status: t.status,
    execution_kind: kind,
    execution_mode: String(t.executionMode || kind || 'unknown'),
    steps_executed: String(t.stepsExecuted),
    agent_success: String(t.isAgentSuccessful ?? 'unknown'),
    status_reason: t.statusReason || 'None',
    failure_context: t.failureContext || 'None',
    url_sequence: t.urlSequence.join(' → ') || 'None',
    nl_steps: nl,
    runtime_insights: insights,
    codegen_summary: codegen || 'None',
    llm_calls: String(t.pricing.llmCalls),
    total_tokens: String(t.pricing.totalTokens),
    prompt_tokens: String(t.pricing.promptTokens),
    completion_tokens: String(t.pricing.completionTokens),
    estimated_cost_usd: t.pricing.estimatedCostUsd.toFixed(4),
    model: t.pricing.model || 'unknown',
    provider: t.pricing.provider || 'unknown',
    execution_sample: sample || 'None',
  };
}

async function analyzeTest(llm: LLMClient, t: TestCaseReport): Promise<string> {
  const system = PromptLoader.load('reports/ai-analysis-system.md');
  const user = PromptLoader.loadWithVars('reports/ai-analysis-user.md', buildTestAiPayload(t));
  const res = await llm.complete([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  return res.text.trim();
}

async function analyzeSuite(llm: LLMClient, report: SuiteExecutionReport): Promise<string> {
  const table = report.testCases
    .map(
      (t) =>
        `- ${t.slug}: ${t.status}, kind=${t.kind || 'web'}, mode=${t.executionMode || '—'}, ${t.stepsExecuted} steps, $${t.pricing.estimatedCostUsd.toFixed(4)}, agent ok=${t.isAgentSuccessful}, reason=${(t.statusReason || t.failureContext || '—').toString().slice(0, 120)}`
    )
    .join('\n');

  const system = PromptLoader.load('reports/ai-analysis-system.md');
  const user = PromptLoader.loadWithVars('reports/ai-analysis-suite-user.md', {
    suite_name: report.suiteName,
    environment: report.environment.name,
    pass_rate: report.overview.passRate.toFixed(1),
    passed: String(report.overview.passed),
    total: String(report.overview.total),
    total_steps: String(report.overview.totalSteps),
    total_cost_usd: report.overview.totalCostUsd.toFixed(4),
    total_tokens: String(report.overview.totalTokens),
    test_results_table: table,
  });

  const res = await llm.complete([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  return res.text.trim();
}

function persistAiAnalysis(slug: string, analysis: string): void {
  const readPath = resolveSummaryPath(slug);
  if (!fs.existsSync(readPath)) return;
  const summary = JSON.parse(fs.readFileSync(readPath, 'utf8')) as Record<string, unknown>;
  summary.aiAnalysis = analysis;
  fs.mkdirSync(path.dirname(summaryFilePath(slug)), { recursive: true });
  fs.writeFileSync(summaryFilePath(slug), JSON.stringify(summary, null, 2), 'utf8');
}

function persistRootCauseAnalysis(slug: string, analysis: RootCauseAnalysis, markdown: string): void {
  const readPath = resolveSummaryPath(slug);
  if (!fs.existsSync(readPath)) return;
  const summary = JSON.parse(fs.readFileSync(readPath, 'utf8')) as Record<string, unknown>;
  summary.rootCauseAnalysis = analysis;
  summary.aiAnalysis = markdown;
  fs.mkdirSync(path.dirname(summaryFilePath(slug)), { recursive: true });
  fs.writeFileSync(summaryFilePath(slug), JSON.stringify(summary, null, 2), 'utf8');
}

function resolveEventBundleForTest(t: TestCaseReport): string | undefined {
  if (t.artifacts.eventBundle) return t.artifacts.eventBundle;
  const readPath = resolveSummaryPath(t.slug);
  if (!fs.existsSync(readPath)) return undefined;
  try {
    const summary = JSON.parse(fs.readFileSync(readPath, 'utf8')) as Record<string, unknown>;
    const runId = typeof summary.runId === 'string' ? summary.runId : undefined;
    if (runId) return eventBundlePath(t.slug, runId);
  } catch {
    /* ignore */
  }
  return undefined;
}

function analyzeGroundedRootCause(
  t: TestCaseReport,
  failOnInvalidCitation: boolean
): RootCauseAnalysis {
  return RootCauseAnalyzer.analyze({
    eventBundlePath: resolveEventBundleForTest(t),
    status: t.status,
    scenarioId: t.slug,
    failOnInvalidCitation,
  });
}

function persistFlakeAnalysis(
  slug: string,
  analysis: NonNullable<ReturnType<typeof FlakeAnalyzer.analyze>>
): void {
  FlakeAnalyzer.persist(slug, analysis);
}

/**
 * Builds HTML execution reports under reports/ (index.html + per-test pages).
 */
export async function generateExecutionReports(
  options: GenerateReportOptions = {}
): Promise<GenerateReportResult> {
  ensureReportDirs();
  ensureReportAssets();

  if (options.testSlugs?.length) {
    for (const slug of options.testSlugs) {
      enrichSummaryMeta(slug, {
        env: options.env,
        testFilePath: options.testFilePath,
        durationMs: options.testDurations?.[slug] ?? options.durationMs,
      });
    }
  }

  const slugsToArchive = options.testSlugs?.length ? options.testSlugs : listSummarySlugs();
  slugsToArchive.forEach(archiveCurrentRun);

  let report = collectSuiteReport({
    suiteName: options.suiteName,
    env: options.env,
    testSlugs: options.testSlugs,
  });

  if (options.durationMs != null && Number.isFinite(options.durationMs)) {
    report.overview.totalDurationMs = Math.max(0, Math.round(options.durationMs));
    report.totalDurationMs = report.overview.totalDurationMs;
  } else {
    const summed = report.testCases.reduce((n, t) => n + (t.durationMs || t.totalDurationMs || 0), 0);
    if (summed > 0) {
      report.overview.totalDurationMs = summed;
      report.totalDurationMs = summed;
    }
  }

  for (const t of report.testCases) {
    if (t.status === 'PASSED' || t.flakeAnalysis) continue;
    const flake = FlakeAnalyzer.analyzeTestCase(t);
    if (flake) {
      t.flakeAnalysis = flake;
      persistFlakeAnalysis(t.slug, flake);
    }
  }

  const flags = resolveFeatureFlags();

  if (flags.groundedRootCause) {
    console.log('\x1b[34m[ExecutionReport] Generating grounded root-cause analysis...\x1b[0m');
    for (const t of report.testCases) {
      if (t.rootCauseAnalysis) continue;
      try {
        const rca = analyzeGroundedRootCause(t, flags.failOnInvalidCitation);
        const markdown = RootCauseAnalyzer.toMarkdown(rca);
        t.rootCauseAnalysis = rca;
        t.aiAnalysis = markdown;
        persistRootCauseAnalysis(t.slug, rca, markdown);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        t.aiAnalysis = `_Grounded root-cause unavailable: ${msg}_`;
      }
    }
  }

  if (!options.skipAi && !flags.groundedRootCause && report.testCases.length > 0) {
    try {
      console.log('\x1b[34m[ExecutionReport] Generating AI analysis...\x1b[0m');
      UsageTracker.setPhase('analysis');
      const llm = new LLMClient();
      for (const t of report.testCases) {
        if (t.aiAnalysis) continue;
        try {
          t.aiAnalysis = await analyzeTest(llm, t);
          persistAiAnalysis(t.slug, t.aiAnalysis);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          t.aiAnalysis = `_AI analysis unavailable: ${msg}_`;
        }
      }
      if (report.testCases.length > 1) {
        report.suiteAiAnalysis = await analyzeSuite(llm, report);
      }
      // Fold analysis tokens into the job total for every test in this report.
      for (const t of report.testCases) {
        persistJobUsage(t.slug);
      }
    } catch (err: unknown) {
      console.warn(
        '\x1b[33m[ExecutionReport] AI analysis skipped:\x1b[0m',
        err instanceof Error ? err.message : err
      );
    }
  } else if (!options.skipAi && flags.groundedRootCause && report.testCases.length > 1) {
    // Optional suite-level free-form rollup still allowed alongside grounded per-test RCA.
    try {
      UsageTracker.setPhase('analysis');
      const llm = new LLMClient();
      report.suiteAiAnalysis = await analyzeSuite(llm, report);
      for (const t of report.testCases) {
        persistJobUsage(t.slug);
      }
    } catch {
      /* suite AI is optional when grounded mode is on */
    }
  }

  const evidenceCfg = resolveEvidenceConfig();
  if (evidenceCfg.enabled && evidenceCfg.writeBundle) {
    console.log('\x1b[34m[ExecutionReport] Writing EvidenceBundles...\x1b[0m');
    for (const t of report.testCases) {
      try {
        const bundle = EvidenceBundleBuilder.writeForSlug(t.slug, { config: evidenceCfg });
        if (bundle) {
          t.risk = bundle.risk;
          t.completeness = bundle.completeness;
          t.evidenceRef = bundle.artifacts.evidenceBundle;
          t.healingCount = bundle.healing.count;
          t.codegenQuality = bundle.codegen.quality;
          t.evidenceTimeline = bundle.timeline;
          t.evidenceHealing = bundle.healing.records;
          t.evidenceLocators = bundle.locators;
          t.evidenceDrift = bundle.pageInventory.drift;
        }
      } catch (err: unknown) {
        console.warn(
          `\x1b[33m[ExecutionReport] Evidence bundle skipped for ${t.slug}:\x1b[0m`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  // Prefer the React report-ui shell (evidence + analytics rendered natively).
  // Fall back to the built-in HTML renderer when the shell is missing, or when
  // WEBPILOT_REPORT_UI=html is set. WEBPILOT_REPORT_UI=shell-v2 selects the
  // temporary vanilla fallback shell.
  const preferHtml = String(process.env.WEBPILOT_REPORT_UI || '').toLowerCase() === 'html';
  const suiteHtmlPath = suiteIndexHtmlPath();
  if (preferHtml) {
    fs.writeFileSync(suiteHtmlPath, renderSuiteHtml(report), 'utf8');
  } else {
    const reactHtml = renderReactSuiteHtml(report);
    if (reactHtml) {
      fs.writeFileSync(suiteHtmlPath, reactHtml, 'utf8');
    } else {
      console.warn(
        '\x1b[33m[ExecutionReport] report-ui shell not found; using built-in HTML renderer.\x1b[0m'
      );
      fs.writeFileSync(suiteHtmlPath, renderSuiteHtml(report), 'utf8');
    }
  }

  const testHtmlPaths: string[] = [];
  for (const t of report.testCases) {
    const html = preferHtml
      ? renderTestHtml(report, t.slug)
      : renderReactTestHtml(report, t.slug) ?? renderTestHtml(report, t.slug);
    if (!html) continue;
    const p = testReportHtmlPath(t.slug);
    fs.writeFileSync(p, html, 'utf8');
    testHtmlPaths.push(p);
  }

  console.log(`\x1b[32m[ExecutionReport] Suite report: ${suiteHtmlPath}\x1b[0m`);
  testHtmlPaths.forEach((p) =>
    console.log(`\x1b[32m[ExecutionReport] Test report: ${p}\x1b[0m`)
  );

  return { suiteHtmlPath, testHtmlPaths };
}
