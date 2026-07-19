import * as fs from 'fs';
import * as path from 'path';
import { SuiteExecutionReport } from './types';
import { findCliInstallRoot } from '../../cli/ProjectContext';
import { appendGovernanceOverlay } from './governanceOverlay';

const SHELL_RELATIVE = path.join('resources', 'report-ui', 'shell.html');
const DATA_SCRIPT_RE =
  /(<script[^>]*id="webpilot-report-data"[^>]*>)([\s\S]*?)(<\/script>)/;

/**
 * Locate the committed report-ui shell. Checks the active project, the CLI
 * install root (for globally linked installs), then the dev build artifact.
 */
function resolveShellPath(): string | null {
  const candidates = [path.join(process.cwd(), SHELL_RELATIVE)];

  try {
    candidates.push(path.join(findCliInstallRoot(), SHELL_RELATIVE));
  } catch {
    /* not running from a linked CLI install; ignore */
  }

  candidates.push(path.join(process.cwd(), 'packages', 'report-ui', 'dist', 'index.html'));

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function reactShellAvailable(): boolean {
  return resolveShellPath() !== null;
}

/**
 * Inject a report object into the report-ui shell's `webpilot-report-data`
 * script tag. Returns null if the shell cannot be found or is malformed.
 */
function injectReportData(report: SuiteExecutionReport): string | null {
  const shellPath = resolveShellPath();
  if (!shellPath) return null;

  const shell = fs.readFileSync(shellPath, 'utf8');
  if (!DATA_SCRIPT_RE.test(shell)) return null;

  // Escape `</script>` so an embedded sequence cannot terminate the tag early.
  const json = JSON.stringify(report).replace(/<\/script>/gi, '<\\/script>');

  const injected = shell.replace(
    DATA_SCRIPT_RE,
    (_match, open: string, _old: string, close: string) => `${open}${json}${close}`
  );
  return appendGovernanceOverlay(injected, report);
}

/**
 * Render the suite report as the React (report-ui) single-page app by injecting
 * the live report JSON into the `webpilot-report-data` script tag of the shell.
 * Returns null if the shell cannot be found, so callers can fall back.
 */
export function renderReactSuiteHtml(report: SuiteExecutionReport): string | null {
  return injectReportData(report);
}

/**
 * Scope a full suite report down to a single test case, recomputing the
 * overview/history aggregates so the report-ui renders a focused per-test page.
 * Mirrors the suite collector's aggregation rules.
 */
function scopeReportToSingleTest(
  report: SuiteExecutionReport,
  slug: string
): SuiteExecutionReport | null {
  const test = report.testCases.find((t) => t.slug === slug);
  if (!test) return null;

  const passed = test.status === 'PASSED' ? 1 : 0;
  const runs = test.runHistory ?? [];

  return {
    ...report,
    suiteName: test.testName || report.suiteName,
    testCases: [test],
    overview: {
      total: 1,
      passed,
      failed: 1 - passed,
      passRate: passed * 100,
      totalSteps: test.stepsExecuted,
      totalCostUsd: test.pricing.estimatedCostUsd,
      totalTokens: test.pricing.totalTokens,
    },
    historyOverview: {
      totalRuns: runs.length,
      promptTokens: runs.reduce((n, run) => n + run.pricing.promptTokens, 0),
      completionTokens: runs.reduce((n, run) => n + run.pricing.completionTokens, 0),
      totalTokens: runs.reduce((n, run) => n + run.pricing.totalTokens, 0),
      totalCostUsd: runs.reduce((n, run) => n + run.pricing.estimatedCostUsd, 0),
      llmCalls: runs.reduce((n, run) => n + run.pricing.llmCalls, 0),
    },
  };
}

/**
 * Render a single test case as a self-contained report-ui page (same SPA shell,
 * data scoped to one test). Returns null if the shell or test is unavailable.
 */
export function renderReactTestHtml(
  report: SuiteExecutionReport,
  slug: string
): string | null {
  const scoped = scopeReportToSingleTest(report, slug);
  if (!scoped) return null;
  return injectReportData(scoped);
}
