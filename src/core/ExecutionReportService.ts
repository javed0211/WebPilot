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
  durationMs?: number;
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
  const sample = t.executionSteps
    .slice(0, 15)
    .map(
      (s) =>
        `${s.index}. [${s.action}] ${s.url || s.selector || ''} — ${(s.description || '').slice(0, 120)}`
    )
    .join('\n');

  const insights = t.runtimeInsights.map((i) => `- [${i.type}] ${i.message}`).join('\n') || 'None';
  const nl = t.nlSteps.map((s, i) => `${i + 1}. ${s}`).join('\n') || 'None';
  const codegen = Array.isArray(t.codegenSummary)
    ? t.codegenSummary.join('\n')
    : String(t.codegenSummary || '');

  return {
    test_slug: t.slug,
    status: t.status,
    steps_executed: String(t.stepsExecuted),
    agent_success: String(t.isAgentSuccessful ?? 'unknown'),
    url_sequence: t.urlSequence.join(' → ') || 'None',
    nl_steps: nl,
    runtime_insights: insights,
    codegen_summary: codegen,
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
        `- ${t.slug}: ${t.status}, ${t.stepsExecuted} steps, $${t.pricing.estimatedCostUsd.toFixed(4)}, agent ok=${t.isAgentSuccessful}`
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
        durationMs: options.durationMs,
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

  for (const t of report.testCases) {
    if (t.status === 'PASSED' || t.flakeAnalysis) continue;
    const flake = FlakeAnalyzer.analyzeTestCase(t);
    if (flake) {
      t.flakeAnalysis = flake;
      persistFlakeAnalysis(t.slug, flake);
    }
  }

  if (!options.skipAi && report.testCases.length > 0) {
    try {
      console.log('\x1b[34m[ExecutionReport] Generating AI analysis...\x1b[0m');
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
    } catch (err: unknown) {
      console.warn(
        '\x1b[33m[ExecutionReport] AI analysis skipped:\x1b[0m',
        err instanceof Error ? err.message : err
      );
    }
  }

  const suiteHtmlPath = suiteIndexHtmlPath();
  const reactHtml = renderReactSuiteHtml(report);
  if (reactHtml) {
    fs.writeFileSync(suiteHtmlPath, reactHtml, 'utf8');
  } else {
    console.warn(
      '\x1b[33m[ExecutionReport] report-ui shell not found; using built-in HTML renderer.\x1b[0m'
    );
    fs.writeFileSync(suiteHtmlPath, renderSuiteHtml(report), 'utf8');
  }

  const testHtmlPaths: string[] = [];
  for (const t of report.testCases) {
    const html = renderReactTestHtml(report, t.slug) ?? renderTestHtml(report, t.slug);
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
