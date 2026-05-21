import * as fs from 'fs';
import * as path from 'path';
import { LLMClient } from './LLMClient';
import { PromptLoader } from './PromptLoader';
import { collectSuiteReport } from './execution_report/collector';
import { renderSuiteHtml, renderTestHtml } from './execution_report/renderHtml';
import { SuiteExecutionReport, TestCaseReport } from './execution_report/types';

function ensureReportAssets(reportsDir: string): void {
  const assetsDir = path.join(reportsDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const dest = path.join(assetsDir, 'webpilot-logo.png');
  if (fs.existsSync(dest)) return;
  const candidates = [
    path.join(process.cwd(), 'assets', 'webpilot-logo.png'),
    path.join(process.cwd(), 'reports', 'assets', 'webpilot-logo.png'),
  ];
  for (const src of candidates) {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      return;
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
  const summaryPath = path.join(process.cwd(), 'reports', `${slug}_summary.json`);
  if (!fs.existsSync(summaryPath)) return;
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as Record<string, unknown>;
    if (meta.env) summary.environment = meta.env;
    if (meta.testFilePath) summary.testFile = meta.testFilePath;
    if (meta.durationMs != null) summary.durationMs = meta.durationMs;
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
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
  const summaryPath = path.join(process.cwd(), 'reports', `${slug}_summary.json`);
  if (!fs.existsSync(summaryPath)) return;
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as Record<string, unknown>;
  summary.aiAnalysis = analysis;
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
}

/**
 * Builds HTML execution reports under reports/ (index.html + per-test pages).
 */
export async function generateExecutionReports(
  options: GenerateReportOptions = {}
): Promise<GenerateReportResult> {
  const reportsDir = path.join(process.cwd(), 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  ensureReportAssets(reportsDir);

  if (options.testSlugs?.length) {
    for (const slug of options.testSlugs) {
      enrichSummaryMeta(slug, {
        env: options.env,
        testFilePath: options.testFilePath,
        durationMs: options.durationMs,
      });
    }
  }

  let report = collectSuiteReport({
    suiteName: options.suiteName,
    env: options.env,
    testSlugs: options.testSlugs,
  });

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

  const suiteHtmlPath = path.join(reportsDir, 'index.html');
  fs.writeFileSync(suiteHtmlPath, renderSuiteHtml(report), 'utf8');

  const testHtmlPaths: string[] = [];
  for (const t of report.testCases) {
    const html = renderTestHtml(report, t.slug);
    if (!html) continue;
    const p = path.join(reportsDir, `${t.slug}-report.html`);
    fs.writeFileSync(p, html, 'utf8');
    testHtmlPaths.push(p);
  }

  console.log(`\x1b[32m[ExecutionReport] Suite report: ${suiteHtmlPath}\x1b[0m`);
  testHtmlPaths.forEach((p) =>
    console.log(`\x1b[32m[ExecutionReport] Test report: ${p}\x1b[0m`)
  );

  return { suiteHtmlPath, testHtmlPaths };
}
