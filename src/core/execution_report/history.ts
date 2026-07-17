import * as fs from 'fs';
import * as path from 'path';
import { ReportPricing, TestRunHistory } from './types';
import {
  REPORTS_HISTORY_DIR,
  resolveLlmUsagePath,
  resolveSummaryPath,
} from '../ReportPaths';
import { estimateCostUsd } from '../../utils/ModelPricing';

function readJson(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pricingFrom(
  summary: Record<string, unknown>,
  usage: Record<string, unknown>
): ReportPricing {
  const promptTokens = numberValue(summary.promptTokens ?? usage.promptTokens);
  const completionTokens = numberValue(summary.completionTokens ?? usage.completionTokens);
  let estimatedCostUsd = numberValue(summary.estimatedCostUsd);
  if (estimatedCostUsd <= 0) {
    estimatedCostUsd = numberValue(usage.estimatedCostUsd);
  }
  if (estimatedCostUsd <= 0 && promptTokens + completionTokens > 0) {
    const model =
      (typeof summary.model === 'string' && summary.model) ||
      process.env.WEBPILOT_LLM_MODEL ||
      'gpt-4.1';
    estimatedCostUsd = estimateCostUsd(model, promptTokens, completionTokens);
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens: numberValue(summary.tokens ?? usage.totalTokens ?? promptTokens + completionTokens),
    estimatedCostUsd,
    llmCalls: numberValue(summary.llmCalls ?? usage.llmCalls),
    model: typeof summary.model === 'string' ? summary.model : undefined,
    provider: typeof summary.provider === 'string' ? summary.provider : undefined,
  };
}

function runIdFrom(timestamp: string): string {
  const safe = timestamp.replace(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, '');
  return safe || `run-${Date.now()}`;
}

/**
 * Saves the latest mutable report files as an immutable run snapshot.
 * Regenerating a report is idempotent because timestamp-derived run IDs overwrite
 * the same snapshot rather than creating duplicates.
 */
export function archiveCurrentRun(slug: string): void {
  const summaryPath = resolveSummaryPath(slug);
  if (!fs.existsSync(summaryPath)) return;

  const summary = readJson(summaryPath);
  const usage = readJson(resolveLlmUsagePath(slug));
  const timestamp = String(summary.timestamp ?? '');
  const knowledgeRaw = summary.knowledge as Record<string, unknown> | undefined;
  const flakeRaw = summary.flakeAnalysis as { category?: string } | undefined;
  const browserRaw = summary.browser as { provider?: { provider?: string } } | undefined;
  const snapshot: TestRunHistory = {
    runId: runIdFrom(timestamp),
    timestamp,
    status: String(summary.status ?? 'UNKNOWN'),
    executionMode:
      typeof summary.executionMode === 'string' ? summary.executionMode : undefined,
    stepsExecuted: numberValue(summary.stepsExecuted),
    pricing: pricingFrom(summary, usage),
    flakeCategory: typeof flakeRaw?.category === 'string' ? flakeRaw.category : undefined,
    browserProvider:
      typeof browserRaw?.provider?.provider === 'string' ? browserRaw.provider.provider : undefined,
    knowledge: knowledgeRaw
      ? {
          reusedSteps: numberValue(knowledgeRaw.reusedSteps),
          learnedSteps: numberValue(knowledgeRaw.learnedSteps),
        }
      : undefined,
  };

  const slugDir = path.join(REPORTS_HISTORY_DIR, slug);
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(
    path.join(slugDir, `${snapshot.runId}.json`),
    JSON.stringify(snapshot, null, 2),
    'utf8'
  );
}

export function loadRunHistory(slug: string): TestRunHistory[] {
  const slugDir = path.join(REPORTS_HISTORY_DIR, slug);
  if (!fs.existsSync(slugDir)) return [];

  return fs
    .readdirSync(slugDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readJson(path.join(slugDir, file)) as unknown as TestRunHistory)
    .filter((run) => Boolean(run.runId && run.pricing))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}
