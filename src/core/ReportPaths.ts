import * as fs from 'fs';
import * as path from 'path';
import { REPORTS_ROOT } from './ProjectPaths';

export const REPORTS_HTML_DIR = path.join(REPORTS_ROOT, 'html');
export const REPORTS_DATA_DIR = path.join(REPORTS_ROOT, 'data');
export const REPORTS_SUMMARIES_DIR = path.join(REPORTS_DATA_DIR, 'summaries');
export const REPORTS_EXECUTION_HISTORY_DIR = path.join(REPORTS_DATA_DIR, 'execution-history');
export const REPORTS_LLM_USAGE_DIR = path.join(REPORTS_DATA_DIR, 'llm-usage');
export const REPORTS_API_DIR = path.join(REPORTS_DATA_DIR, 'api');
export const REPORTS_LOGS_DIR = path.join(REPORTS_DATA_DIR, 'logs');
export const REPORTS_MARKDOWN_DIR = path.join(REPORTS_ROOT, 'markdown');
export const REPORTS_JUNIT_DIR = path.join(REPORTS_ROOT, 'junit');
export const REPORTS_VIDEOS_DIR = path.join(REPORTS_ROOT, 'videos');
export const REPORTS_TRACES_DIR = path.join(REPORTS_ROOT, 'traces');
export const REPORTS_SCREENSHOTS_DIR = path.join(REPORTS_ROOT, 'screenshots');
export const REPORTS_ASSETS_DIR = path.join(REPORTS_ROOT, 'assets');
export const REPORTS_HISTORY_DIR = path.join(REPORTS_ROOT, 'history');
export const REPORTS_EVENTS_DIR = path.join(REPORTS_DATA_DIR, 'events');
export const REPORTS_EVIDENCE_DIR = path.join(REPORTS_DATA_DIR, 'evidence');

const REPORT_DIRS = [
  REPORTS_HTML_DIR,
  REPORTS_SUMMARIES_DIR,
  REPORTS_EXECUTION_HISTORY_DIR,
  REPORTS_LLM_USAGE_DIR,
  REPORTS_API_DIR,
  REPORTS_LOGS_DIR,
  REPORTS_MARKDOWN_DIR,
  REPORTS_JUNIT_DIR,
  REPORTS_VIDEOS_DIR,
  REPORTS_TRACES_DIR,
  REPORTS_SCREENSHOTS_DIR,
  REPORTS_ASSETS_DIR,
  REPORTS_HISTORY_DIR,
  REPORTS_EVENTS_DIR,
  REPORTS_EVIDENCE_DIR,
] as const;

export function ensureReportDirs(): void {
  for (const dir of REPORT_DIRS) {
    fs.mkdirSync(dir, { recursive: true });
  }
  migrateLegacyReportFiles();
}

type LegacyMoveRule = {
  match: (fileName: string) => boolean;
  destDir: string;
};

const LEGACY_MOVE_RULES: LegacyMoveRule[] = [
  { match: (f) => f.endsWith('_summary.json'), destDir: REPORTS_SUMMARIES_DIR },
  { match: (f) => f.endsWith('_execution_history.json'), destDir: REPORTS_EXECUTION_HISTORY_DIR },
  { match: (f) => f.endsWith('_llm_usage.json'), destDir: REPORTS_LLM_USAGE_DIR },
  { match: (f) => f.startsWith('api-') && f.endsWith('.json'), destDir: REPORTS_API_DIR },
  { match: (f) => f.endsWith('-report.html'), destDir: REPORTS_HTML_DIR },
  { match: (f) => f === 'index.html', destDir: REPORTS_HTML_DIR },
  { match: (f) => f === 'execution_analysis_report.md', destDir: REPORTS_MARKDOWN_DIR },
  { match: (f) => f === 'junit-results.xml', destDir: REPORTS_JUNIT_DIR },
  { match: (f) => f.endsWith('_cli_output.txt'), destDir: REPORTS_LOGS_DIR },
];

/** Move flat files from `runtime/reports/` root into typed subfolders. */
export function migrateLegacyReportFiles(): number {
  if (!fs.existsSync(REPORTS_ROOT)) return 0;

  let moved = 0;
  for (const fileName of fs.readdirSync(REPORTS_ROOT)) {
    const source = path.join(REPORTS_ROOT, fileName);
    if (!fs.statSync(source).isFile()) continue;

    const rule = LEGACY_MOVE_RULES.find((r) => r.match(fileName));
    if (!rule) continue;

    fs.mkdirSync(rule.destDir, { recursive: true });
    const destination = path.join(rule.destDir, fileName);
    if (fs.existsSync(destination)) {
      fs.unlinkSync(source);
    } else {
      fs.renameSync(source, destination);
    }
    moved += 1;
  }

  return moved;
}

export function summaryPath(slug: string): string {
  return path.join(REPORTS_SUMMARIES_DIR, `${slug}_summary.json`);
}

export function executionHistoryPath(slug: string): string {
  return path.join(REPORTS_EXECUTION_HISTORY_DIR, `${slug}_execution_history.json`);
}

export function workflowPath(slug: string): string {
  return path.join(REPORTS_EXECUTION_HISTORY_DIR, `${slug}_workflow.json`);
}

export function llmUsagePath(slug: string): string {
  return path.join(REPORTS_LLM_USAGE_DIR, `${slug}_llm_usage.json`);
}

export function testReportHtmlPath(slug: string): string {
  return path.join(REPORTS_HTML_DIR, `${slug}-report.html`);
}

export function suiteIndexHtmlPath(): string {
  return path.join(REPORTS_HTML_DIR, 'index.html');
}

export function apiReportPath(reportName: string, timestamp: number): string {
  return path.join(REPORTS_API_DIR, `api-${reportName}-${timestamp}.json`);
}

export function markdownReportPath(): string {
  return path.join(REPORTS_MARKDOWN_DIR, 'execution_analysis_report.md');
}

export function junitResultsPath(): string {
  return path.join(REPORTS_JUNIT_DIR, 'junit-results.xml');
}

function legacySummaryPath(slug: string): string {
  return path.join(REPORTS_ROOT, `${slug}_summary.json`);
}

function legacyExecutionHistoryPath(slug: string): string {
  return path.join(REPORTS_ROOT, `${slug}_execution_history.json`);
}

function legacyLlmUsagePath(slug: string): string {
  return path.join(REPORTS_ROOT, `${slug}_llm_usage.json`);
}

export function resolveSummaryPath(slug: string): string {
  const next = summaryPath(slug);
  if (fs.existsSync(next)) return next;
  const legacy = legacySummaryPath(slug);
  if (fs.existsSync(legacy)) return legacy;
  return next;
}

export function resolveExecutionHistoryPath(slug: string): string {
  const next = executionHistoryPath(slug);
  if (fs.existsSync(next)) return next;
  const legacy = legacyExecutionHistoryPath(slug);
  if (fs.existsSync(legacy)) return legacy;
  return next;
}

export function resolveLlmUsagePath(slug: string): string {
  const next = llmUsagePath(slug);
  if (fs.existsSync(next)) return next;
  const legacy = legacyLlmUsagePath(slug);
  if (fs.existsSync(legacy)) return legacy;
  return next;
}

export function listSummarySlugs(): string[] {
  const slugs = new Set<string>();

  const collect = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('_summary.json')) {
        slugs.add(file.replace('_summary.json', ''));
      }
    }
  };

  collect(REPORTS_SUMMARIES_DIR);
  if (fs.existsSync(REPORTS_ROOT)) {
    for (const file of fs.readdirSync(REPORTS_ROOT)) {
      if (file.endsWith('_summary.json')) {
        slugs.add(file.replace('_summary.json', ''));
      }
    }
  }

  return [...slugs];
}

/** Path relative to `runtime/reports/html/` for artifact links in HTML reports. */
export function hrefFromReportsHtml(absOrRel: string): string {
  const normalized = absOrRel.replace(/\\/g, '/');
  if (normalized.startsWith('../') || normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized;
  }

  let rel = normalized;
  const reportsMarker = 'runtime/reports/';
  const idx = normalized.indexOf(reportsMarker);
  if (idx >= 0) {
    rel = normalized.slice(idx + reportsMarker.length);
  } else if (path.isAbsolute(absOrRel)) {
    rel = path.relative(REPORTS_ROOT, absOrRel).replace(/\\/g, '/');
  }

  // Some legacy summaries stored artifact paths relative to the runtime root
  // (e.g. `reports/videos/x.mp4`). Strip those prefixes so the href is always
  // relative to the reports root, which is what `html/` resolves against.
  rel = rel.replace(/^runtime\//, '').replace(/^reports\//, '');

  return rel.startsWith('../') ? rel : `../${rel}`;
}
