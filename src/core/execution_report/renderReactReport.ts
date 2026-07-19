import * as fs from 'fs';
import * as path from 'path';
import { SuiteExecutionReport } from './types';
import { findCliInstallRoot } from '../../cli/ProjectContext';

const SHELL_RELATIVE = path.join('resources', 'report-ui', 'shell.html');
/** Temporary fallback while the React shell is validated in the field. */
const SHELL_V2_RELATIVE = path.join('resources', 'report-ui', 'shell-v2.html');
const DATA_SCRIPT_RE =
  /(<script[^>]*id="webpilot-report-data"[^>]*>)([\s\S]*?)(<\/script>)/;

/**
 * Locate the committed report-ui shell. Prefers the React single-file build
 * (`shell.html`), then the vanilla shell-v2 fallback, then the Vite dist artifact.
 */
function resolveShellPath(): string | null {
  const preferLegacy =
    String(process.env.WEBPILOT_REPORT_UI || '').toLowerCase() === 'shell-v2';

  const candidates = preferLegacy
    ? [
        path.join(process.cwd(), SHELL_V2_RELATIVE),
        path.join(process.cwd(), SHELL_RELATIVE),
      ]
    : [
        path.join(process.cwd(), SHELL_RELATIVE),
        path.join(process.cwd(), SHELL_V2_RELATIVE),
      ];

  try {
    const installRoot = findCliInstallRoot();
    if (preferLegacy) {
      candidates.push(path.join(installRoot, SHELL_V2_RELATIVE));
      candidates.push(path.join(installRoot, SHELL_RELATIVE));
    } else {
      candidates.push(path.join(installRoot, SHELL_RELATIVE));
      candidates.push(path.join(installRoot, SHELL_V2_RELATIVE));
    }
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

  // Both the React shell and shell-v2 render evidence/governance natively.
  return shell.replace(
    DATA_SCRIPT_RE,
    (_match, open: string, _old: string, close: string) => `${open}${json}${close}`
  );
}

/**
 * Render the suite report as the React (report-ui) single-page app by injecting
 * the live report JSON into the `webpilot-report-data` script tag of the shell.
 * Returns null if the shell cannot be found, so callers can fall back.
 */
export function renderReactSuiteHtml(report: SuiteExecutionReport): string | null {
  return injectReportData(withFriendlySuiteName(report));
}

/**
 * A single-test suite is really just that one test, but the CLI names the suite
 * from the slug (e.g. `WebPilot — booking_search_hotels`). Prefer the test's
 * human-readable title so the suite sidebar matches the per-test page.
 */
function withFriendlySuiteName(report: SuiteExecutionReport): SuiteExecutionReport {
  if (report.testCases.length !== 1) return report;
  const friendly = report.testCases[0].testName;
  if (!friendly || friendly === report.suiteName) return report;
  return { ...report, suiteName: friendly };
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
      totalDurationMs: test.durationMs || test.totalDurationMs,
    },
    totalDurationMs: test.durationMs || test.totalDurationMs,
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
