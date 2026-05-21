import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ConfigManager } from '../ConfigManager';
import {
  ReportArtifacts,
  ReportBrowser,
  ReportEnvironment,
  ReportPricing,
  ReportStep,
  SuiteExecutionReport,
  TestCaseReport,
} from './types';

const REPORTS_DIR = 'reports';

export function loadEnvConfig(envName: string): ReportEnvironment {
  const envPath = path.join(process.cwd(), 'config', 'environments', `${envName}.json`);
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

export function loadBrowserConfig(): ReportBrowser {
  const cm = ConfigManager.getInstance();
  const vp = cm.get('browser.viewport', { width: 1280, height: 720 });
  return {
    target: cm.get('browser.target', 'chrome'),
    channel: cm.get('browser.target', 'chrome'),
    headless: Boolean(cm.get('browser.headless', true)),
    viewport: vp,
    video: String(cm.get('browser.video', 'on')),
    trace: String(cm.get('browser.trace', 'on')),
    screenshots: String(cm.get('browser.screenshots', 'only-on-failure')),
  };
}

export function loadFrameworkMeta(): SuiteExecutionReport['framework'] {
  const cm = ConfigManager.getInstance();
  let version = '1.0.0';
  try {
    const ypath = path.join(process.cwd(), 'config', 'webpilot.yaml');
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
    const llmPath = path.join(process.cwd(), 'config', 'llm.json');
    if (!fs.existsSync(llmPath)) return {};
    const llm = JSON.parse(fs.readFileSync(llmPath, 'utf8'));
    const provider = ConfigManager.getInstance().get('framework.activeProvider', 'azure');
    const pconf = llm[provider] || {};
    return { provider, model: pconf.model || pconf.deploymentId };
  } catch {
    return {};
  }
}

function listSummaryFiles(): string[] {
  const dir = path.join(process.cwd(), REPORTS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('_summary.json'))
    .map((f) => path.join(dir, f));
}

/** Path relative to reports/ folder (for hrefs in index.html). */
function hrefFromReports(absOrRel: string): string {
  const normalized = absOrRel.replace(/\\/g, '/');
  let rel = normalized;
  const idx = normalized.indexOf('reports/');
  if (idx >= 0) rel = normalized.slice(idx + 'reports/'.length);
  else if (path.isAbsolute(absOrRel)) {
    rel = path.relative(path.join(process.cwd(), REPORTS_DIR), absOrRel).replace(/\\/g, '/');
  }
  return rel;
}

function loadExecutionContext(slug: string): Record<string, unknown> | null {
  const histPath = path.join(process.cwd(), REPORTS_DIR, `${slug}_execution_history.json`);
  if (!fs.existsSync(histPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(histPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function collectScreenshots(slug: string, summary: Record<string, unknown>): string[] {
  const fromSummary = (summary.artifacts as ReportArtifacts | undefined)?.screenshots;
  if (Array.isArray(fromSummary) && fromSummary.length > 0) {
    return fromSummary.map(hrefFromReports);
  }
  const dir = path.join(process.cwd(), REPORTS_DIR, 'screenshots', slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .sort()
    .map((f) => `screenshots/${slug}/${f}`);
}

function buildPricing(slug: string, summary: Record<string, unknown>): ReportPricing {
  const usagePath = path.join(process.cwd(), REPORTS_DIR, `${slug}_llm_usage.json`);
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
  return {
    promptTokens,
    completionTokens,
    totalTokens: Number(summary.tokens ?? promptTokens + completionTokens),
    estimatedCostUsd: Number(summary.estimatedCostUsd ?? usage.estimatedCostUsd ?? 0),
    llmCalls: Number(summary.llmCalls ?? usage.llmCalls ?? 0),
    model: (summary.model as string) || llmMeta.model,
    provider: (summary.provider as string) || llmMeta.provider,
  };
}

export function collectTestCaseReport(slug: string): TestCaseReport | null {
  const summaryPath = path.join(process.cwd(), REPORTS_DIR, `${slug}_summary.json`);
  if (!fs.existsSync(summaryPath)) return null;

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as Record<string, unknown>;
  const ctx = loadExecutionContext(slug);
  const artifactsRaw = (summary.artifacts as Record<string, string>) || {};

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

  return {
    slug,
    testName: String(summary.testName ?? ctx?.testName ?? slug),
    testFile: summary.testFile as string | undefined,
    status: String(summary.status ?? 'UNKNOWN'),
    timestamp: String(summary.timestamp ?? ''),
    stepsExecuted: Number(summary.stepsExecuted ?? executionSteps.length),
    nlSteps,
    executionSteps,
    urlSequence,
    runtimeInsights: insights,
    codegenSummary,
    artifacts: {
      video: artifactsRaw.video ? hrefFromReports(artifactsRaw.video) : undefined,
      trace: artifactsRaw.trace ? hrefFromReports(artifactsRaw.trace) : undefined,
      screenshots: collectScreenshots(slug, summary),
    },
    pricing: buildPricing(slug, summary),
    executionHistoryPath: summary.executionHistoryPath as string | undefined,
    isAgentSuccessful: ctx?.isSuccessful as boolean | undefined,
    isAgentDone: ctx?.isDone as boolean | undefined,
    aiAnalysis: summary.aiAnalysis as string | undefined,
  };
}

export function collectSuiteReport(options: {
  suiteName?: string;
  env?: string;
  testSlugs?: string[];
}): SuiteExecutionReport {
  const envName = options.env || ConfigManager.getInstance().get('framework.defaultEnvironment', 'qa');

  let slugs = options.testSlugs;
  if (!slugs?.length) {
    slugs = listSummaryFiles().map((f) => path.basename(f).replace('_summary.json', ''));
  }

  const testCases = slugs
    .map((s) => collectTestCaseReport(s))
    .filter((t): t is TestCaseReport => t !== null)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  const passed = testCases.filter((t) => t.status === 'PASSED').length;
  const failed = testCases.length - passed;

  return {
    generatedAt: new Date().toISOString(),
    suiteName: options.suiteName || 'WebPilot Execution Suite',
    environment: loadEnvConfig(envName),
    browser: loadBrowserConfig(),
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
    },
  };
}
