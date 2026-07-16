import * as fs from 'fs';
import * as path from 'path';
import {
  REPORTS_EXECUTION_HISTORY_DIR,
  REPORTS_SUMMARIES_DIR,
  REPORTS_LLM_USAGE_DIR,
  REPORTS_HTML_DIR,
  REPORTS_SCREENSHOTS_DIR,
  REPORTS_VIDEOS_DIR,
  REPORTS_TRACES_DIR,
  REPORTS_LOGS_DIR,
  ensureReportDirs,
  resolveExecutionHistoryPath,
} from './ReportPaths';
import {
  REPORTS_ROOT,
  CODEGEN_ROOT,
  CODEGEN_TRACES_DIR,
  CODEGEN_PLANS_DIR,
  CODEGEN_HISTORY_DIR,
} from './ProjectPaths';

export interface HistoryClearOptions {
  /** Also remove summary, llm-usage, HTML, screenshots, video, trace, failure memory. */
  related?: boolean;
}

export interface HistoryClearResult {
  slug?: string;
  removed: string[];
  missing: string[];
}

function safeUnlink(filePath: string, removed: string[], missing: string[]): void {
  if (!fs.existsSync(filePath)) {
    missing.push(filePath);
    return;
  }
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    fs.rmSync(filePath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(filePath);
  }
  removed.push(filePath);
}

/** Normalize `Digital`, `Digital.txt`, or a path to the scenario slug. */
export function normalizeHistorySlug(input: string): string {
  const base = path.basename(input.trim());
  return base.replace(/\.(txt|spec\.ts|test\.ts|py)$/i, '');
}

export function listExecutionHistorySlugs(): string[] {
  ensureReportDirs();
  const slugs = new Set<string>();

  const collect = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('_execution_history.json')) {
        slugs.add(file.replace(/_execution_history\.json$/i, ''));
      }
    }
  };

  collect(REPORTS_EXECUTION_HISTORY_DIR);
  if (fs.existsSync(REPORTS_ROOT)) {
    for (const file of fs.readdirSync(REPORTS_ROOT)) {
      if (file.endsWith('_execution_history.json')) {
        slugs.add(file.replace(/_execution_history\.json$/i, ''));
      }
    }
  }

  return [...slugs].sort((a, b) => a.localeCompare(b));
}

function relatedPathsForSlug(slug: string): string[] {
  const failureMemory = path.join(CODEGEN_ROOT, 'failures', `${slug}.json`);
  return [
    path.join(REPORTS_SUMMARIES_DIR, `${slug}_summary.json`),
    path.join(REPORTS_ROOT, `${slug}_summary.json`),
    path.join(REPORTS_LLM_USAGE_DIR, `${slug}_llm_usage.json`),
    path.join(REPORTS_ROOT, `${slug}_llm_usage.json`),
    path.join(REPORTS_HTML_DIR, `${slug}-report.html`),
    path.join(REPORTS_ROOT, `${slug}-report.html`),
    path.join(REPORTS_LOGS_DIR, `${slug}_cli_output.txt`),
    path.join(REPORTS_ROOT, `${slug}_cli_output.txt`),
    path.join(REPORTS_SCREENSHOTS_DIR, slug),
    path.join(REPORTS_VIDEOS_DIR, `${slug}.mp4`),
    path.join(REPORTS_VIDEOS_DIR, `${slug}.webm`),
    path.join(REPORTS_TRACES_DIR, `${slug}_trace.zip`),
    path.join(REPORTS_TRACES_DIR, `${slug}.zip`),
    path.join(CODEGEN_TRACES_DIR, `${slug}.json`),
    path.join(CODEGEN_PLANS_DIR, `${slug}.json`),
    path.join(CODEGEN_HISTORY_DIR, `${slug}.json`),
    failureMemory,
  ];
}

function actHistoryPathsForSlug(slug: string): string[] {
  return [
    resolveExecutionHistoryPath(slug),
    path.join(REPORTS_EXECUTION_HISTORY_DIR, `${slug}_execution_history.json`),
    path.join(REPORTS_ROOT, `${slug}_execution_history.json`),
  ];
}

/** Clear ActHistory (and optionally related report artifacts) for one scenario slug. */
export function clearHistoryForSlug(
  slugOrPath: string,
  options: HistoryClearOptions = {}
): HistoryClearResult {
  ensureReportDirs();
  const slug = normalizeHistorySlug(slugOrPath);
  const removed: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  const candidates = [
    ...actHistoryPathsForSlug(slug),
    ...(options.related ? relatedPathsForSlug(slug) : []),
  ];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const before = removed.length;
    safeUnlink(resolved, removed, missing);
    // Don't list every missing related file — only report paths that existed or primary history.
    if (removed.length === before && !actHistoryPathsForSlug(slug).some((p) => path.resolve(p) === resolved)) {
      missing.pop();
    }
  }

  return { slug, removed, missing };
}

/** Clear all ActHistory files (and optionally related artifacts for each slug). */
export function clearAllHistory(options: HistoryClearOptions = {}): HistoryClearResult {
  ensureReportDirs();
  const slugs = listExecutionHistorySlugs();
  const removed: string[] = [];
  const missing: string[] = [];

  for (const slug of slugs) {
    const result = clearHistoryForSlug(slug, options);
    removed.push(...result.removed);
  }

  // Sweep any leftover *_execution_history.json that slug parsing might miss.
  for (const dir of [REPORTS_EXECUTION_HISTORY_DIR, REPORTS_ROOT]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('_execution_history.json')) continue;
      const full = path.join(dir, file);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
      safeUnlink(full, removed, missing);
    }
  }

  return { removed, missing };
}
