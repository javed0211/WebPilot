import * as fs from 'fs';
import * as path from 'path';
import { ensureReportDirs, resolveLlmUsagePath, resolveSummaryPath, summaryPath } from '../core/ReportPaths';
import { UsageFilePayload, UsageSnapshot, UsageTracker } from './UsageTracker';

/**
 * Writes the final job LLM usage snapshot to disk so reports match the CLI job summary.
 */
export function persistJobUsage(
  slug: string,
  snapshot: UsageSnapshot = UsageTracker.getSnapshot()
): void {
  ensureReportDirs();

  const usagePayload: UsageFilePayload = {
    promptTokens: snapshot.promptTokens,
    completionTokens: snapshot.completionTokens,
    estimatedCostUsd: Number(snapshot.estimatedCostUsd.toFixed(6)),
    llmCalls: snapshot.llmCalls,
    phases: snapshot.phases,
    sources: ['browser-use', 'codegen-validation', 'webpilot-cli'],
  };

  const usageFile = resolveLlmUsagePath(slug);
  fs.mkdirSync(path.dirname(usageFile), { recursive: true });
  fs.writeFileSync(usageFile, JSON.stringify(usagePayload, null, 2), 'utf8');

  const summaryFile = resolveSummaryPath(slug);
  let summary: Record<string, unknown> = {};
  if (fs.existsSync(summaryFile)) {
    try {
      summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8')) as Record<string, unknown>;
    } catch {
      summary = {};
    }
  }

  summary.tokens = snapshot.totalTokens;
  summary.promptTokens = snapshot.promptTokens;
  summary.completionTokens = snapshot.completionTokens;
  summary.estimatedCostUsd = Number(snapshot.estimatedCostUsd.toFixed(6));
  summary.llmCalls = snapshot.llmCalls;
  summary.phases = snapshot.phases;

  fs.mkdirSync(path.dirname(summaryPath(slug)), { recursive: true });
  fs.writeFileSync(summaryPath(slug), JSON.stringify(summary, null, 2), 'utf8');
}
