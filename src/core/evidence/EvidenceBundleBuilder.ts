import * as fs from 'fs';
import * as path from 'path';
import { auditPath } from '../codegen/CodegenPaths';
import type { CodegenAudit } from '../codegen/CodegenAuditWriter';
import {
  resolveExecutionHistoryPath,
  resolveLlmUsagePath,
  resolveSummaryPath,
  summaryPath as canonicalSummaryPath,
} from '../ReportPaths';
import type { ActHistoryDocument, ActHealingRecord, ActLocator, ActStep } from '../replay/ActHistoryTypes';
import { createRunId } from '../events/ExecutionEvent';
import { computePageDrift } from '../replay/PageInventoryHistory';
import { CompletenessGrader } from './CompletenessGrader';
import { resolveEvidenceConfig, type EvidenceFeatureConfig } from './EvidenceConfig';
import {
  evidenceBundlePath,
  evidenceBundleRel,
  evidenceStepTimelinePath,
  ensureEvidenceDirs,
} from './EvidencePaths';
import { RiskScorer } from './RiskScorer';
import {
  EVIDENCE_BUNDLE_SCHEMA_VERSION,
  type EvidenceArtifacts,
  type EvidenceBundle,
  type EvidenceCodegen,
  type EvidenceFlake,
  type EvidenceHealingRecord,
  type EvidenceLlmUsage,
  type EvidenceLocatorSummary,
  type EvidenceOutcome,
  type EvidenceTimelineStep,
} from './types';

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function asOutcome(status: unknown): EvidenceOutcome {
  const s = String(status || 'UNKNOWN').toUpperCase();
  if (s === 'PASSED' || s === 'FAILED' || s === 'SKIPPED') return s;
  return 'UNKNOWN';
}

function primaryLocator(step: ActStep): ActLocator | undefined {
  const locs = step.locators || [];
  if (!locs.length) return undefined;
  const verified = locs.find((l) => l.verified);
  return verified || locs[0];
}

function buildTimeline(
  steps: ActStep[],
  nlSteps: string[],
  healing: ActHealingRecord[],
  assertionPlan: ActHistoryDocument['assertionPlan'],
  stepResults?: Array<{ index: number; ok: boolean; error?: string; healed?: boolean; locatorUsed?: string; screenshotPath?: string }>
): EvidenceTimelineStep[] {
  const healedIndexes = new Set(healing.map((h) => h.stepIndex));
  const resultByIndex = new Map((stepResults || []).map((r) => [r.index, r]));
  const assertionByIndex = new Map((assertionPlan || []).map((a) => [a.index, a]));

  return steps.map((step, i) => {
    const loc = primaryLocator(step);
    const result = resultByIndex.get(step.index);
    const healed = Boolean(result?.healed) || healedIndexes.has(step.index);
    let outcome: EvidenceOutcome = 'UNKNOWN';
    if (result) {
      outcome = result.ok ? 'PASSED' : 'FAILED';
    }

    const assertionItem = assertionByIndex.get(step.index);
    const used =
      result?.locatorUsed ||
      (loc
        ? loc.kind === 'role'
          ? `getByRole('${loc.value}'${loc.name ? `, { name: '${loc.name}' }` : ''})`
          : `${loc.kind}=${loc.value || loc.name || ''}`
        : step.selector || undefined);

    return {
      index: step.index ?? i,
      nlStep: nlSteps[step.index ?? i] || step.description || undefined,
      action: step.action || 'unknown',
      url: step.url ?? null,
      pageTitle: step.pageTitle ?? null,
      control: {
        accessibleName: loc?.name || loc?.filterText || undefined,
        tag: loc?.tag,
        elementIndex: step.elementIndex ?? null,
      },
      locator: loc
        ? {
            kind: loc.kind,
            value: loc.value,
            name: loc.name,
            used,
            verified: loc.verified,
            verifiedBy: loc.verified ? 'inventory' : undefined,
            matchCount: loc.matchCount,
          }
        : used
          ? { used, verified: false }
          : null,
      outcome,
      after: step.url ? { url: step.url, inventoryChanged: false } : null,
      assertion: assertionItem
        ? { kind: assertionItem.kind, nlStep: assertionItem.nlStep }
        : null,
      healed,
      screenshotPath: result?.screenshotPath ?? null,
      error: result?.error ?? null,
    };
  });
}

function summarizeLocators(timeline: EvidenceTimelineStep[]): EvidenceLocatorSummary {
  const withLoc = timeline.filter((t) => t.locator?.used || t.locator?.kind);
  const verified = withLoc.filter((t) => t.locator?.verified === true).length;
  const total = withLoc.length;
  return {
    total,
    verified,
    unverified: Math.max(0, total - verified),
    verifiedRatio: total > 0 ? verified / total : 1,
  };
}

function mapHealing(records: ActHealingRecord[]): EvidenceHealingRecord[] {
  return records.map((h) => ({
    stepIndex: h.stepIndex,
    brokenSelector: h.brokenSelector,
    healedSelector: h.healedSelector,
    confidence: h.confidence,
    reasoning: h.reasoning,
    proposalPath: h.proposalPath,
    at: h.at,
    classification: h.classification,
    committed: h.committed,
  }));
}

function loadCodegen(slug: string, summary: Record<string, unknown>): EvidenceCodegen {
  const codegen = (summary.codegen || {}) as Record<string, unknown>;
  const auditFile = auditPath(slug);
  const audit = readJson<CodegenAudit>(auditFile);
  return {
    mode: typeof codegen.mode === 'string' ? codegen.mode : undefined,
    auditPath: fs.existsSync(auditFile)
      ? path.relative(process.cwd(), auditFile).replace(/\\/g, '/')
      : undefined,
    quality: audit?.quality,
    qualityReasons: audit?.qualityReasons,
    pomMappedStepRatio: audit?.pomMappedStepRatio,
    rawFallbackUsed: audit?.rawFallbackUsed,
  };
}

function loadLlmUsage(slug: string, summary: Record<string, unknown>): EvidenceLlmUsage {
  const usageFile = resolveLlmUsagePath(slug);
  const usage = readJson<Record<string, unknown>>(usageFile) || {};
  return {
    promptTokens: Number(summary.promptTokens ?? usage.promptTokens ?? 0),
    completionTokens: Number(summary.completionTokens ?? usage.completionTokens ?? 0),
    totalTokens: Number(summary.tokens ?? usage.totalTokens ?? 0),
    estimatedCostUsd: Number(summary.estimatedCostUsd ?? usage.estimatedCostUsd ?? 0),
    llmCalls: Number(summary.llmCalls ?? usage.llmCalls ?? 0),
    phases: (summary.phases || usage.phases) as EvidenceLlmUsage['phases'],
  };
}

export interface BuildEvidenceOptions {
  slug: string;
  summary?: Record<string, unknown>;
  history?: ActHistoryDocument | null;
  stepResults?: Array<{
    index: number;
    ok: boolean;
    error?: string;
    healed?: boolean;
    locatorUsed?: string;
    screenshotPath?: string;
  }>;
  config?: EvidenceFeatureConfig;
  /** Force a runId (otherwise summary.runId or generated). */
  runId?: string;
}

/**
 * Aggregates on-disk run signals into a schema-versioned EvidenceBundle.
 */
export class EvidenceBundleBuilder {
  public static build(options: BuildEvidenceOptions): EvidenceBundle {
    const config = options.config || resolveEvidenceConfig();
    const slug = options.slug;
    const summary =
      options.summary ||
      readJson<Record<string, unknown>>(resolveSummaryPath(slug)) ||
      {};
    const historyPath = resolveExecutionHistoryPath(slug);
    const history =
      options.history ||
      readJson<ActHistoryDocument>(historyPath) ||
      ({} as ActHistoryDocument);

    const artifactsProbe = (summary.artifacts || {}) as Record<string, unknown>;
    let stepResults = options.stepResults;
    if (!stepResults && typeof artifactsProbe.stepResults === 'string') {
      const loaded = readJson<{
        stepResults?: Array<{
          index: number;
          ok: boolean;
          error?: string;
          healed?: boolean;
          locatorUsed?: string;
          screenshotPath?: string;
        }>;
      }>(
        path.isAbsolute(artifactsProbe.stepResults)
          ? artifactsProbe.stepResults
          : path.join(process.cwd(), artifactsProbe.stepResults)
      );
      stepResults = loaded?.stepResults;
    }

    const steps: ActStep[] =
      history.actHistory?.length
        ? history.actHistory
        : history.executionHistory?.length
          ? history.executionHistory
          : [];
    const nlSteps = history.nlSteps || [];
    const healingRecords = history.runLog?.healing || [];
    const timeline = buildTimeline(
      steps,
      nlSteps,
      healingRecords,
      history.assertionPlan,
      stepResults
    );

    const runId =
      options.runId ||
      (typeof summary.runId === 'string' ? summary.runId : undefined) ||
      createRunId(slug);

    const status = asOutcome(summary.status);
    const browser = (summary.browser || {}) as Record<string, unknown>;
    const provider = (browser.provider || {}) as Record<string, unknown>;
    const artifactsRaw = (summary.artifacts || {}) as Record<string, unknown>;
    const flakeRaw = (summary.flakeAnalysis || {}) as Record<string, unknown>;

    const artifacts: EvidenceArtifacts = {
      executionHistory: fs.existsSync(historyPath)
        ? path.relative(process.cwd(), historyPath).replace(/\\/g, '/')
        : undefined,
      summary: path
        .relative(process.cwd(), resolveSummaryPath(slug))
        .replace(/\\/g, '/'),
      video: typeof artifactsRaw.video === 'string' ? artifactsRaw.video : undefined,
      trace: typeof artifactsRaw.trace === 'string' ? artifactsRaw.trace : undefined,
      screenshots: Array.isArray(artifactsRaw.screenshots)
        ? (artifactsRaw.screenshots as string[])
        : [],
      codegenAudit: undefined,
      eventBundle:
        typeof artifactsRaw.eventBundle === 'string' ? artifactsRaw.eventBundle : undefined,
    };

    const locators = summarizeLocators(timeline);
    const assertionPlan = history.assertionPlan || [];
    const assertions = {
      planned: assertionPlan.length,
      executed: timeline.filter((t) => t.assertion).length,
      strong: 0,
      weak: assertionPlan.length,
      items: assertionPlan.map((a) => ({
        index: a.index,
        kind: a.kind,
        nlStep: a.nlStep,
      })),
    };

    // Prefer assertion strength from summary codegen when present
    const assertionSummary = (summary.codegen as Record<string, unknown> | undefined)
      ?.assertionSummary as { strong?: number; weak?: number; total?: number } | undefined;
    if (assertionSummary) {
      assertions.strong = Number(assertionSummary.strong || 0);
      assertions.weak = Number(assertionSummary.weak || 0);
      if (typeof assertionSummary.total === 'number') {
        assertions.executed = assertionSummary.total;
      }
    }

    const healing = {
      count: healingRecords.length,
      records: mapHealing(healingRecords),
    };

    const pagesTouched = Array.from(
      new Set(
        [
          ...(history.urlSequence || []),
          ...timeline.map((t) => t.url).filter(Boolean),
        ].map((u) => String(u))
      )
    );

    const codegen = loadCodegen(slug, summary);
    if (codegen.auditPath) artifacts.codegenAudit = codegen.auditPath;

    const llmUsage = loadLlmUsage(slug, summary);
    const flake: EvidenceFlake = {
      category: (flakeRaw.category as string) || null,
      confidence: typeof flakeRaw.confidence === 'number' ? flakeRaw.confidence : null,
      likelyCause: (flakeRaw.likelyCause as string) || null,
      recommendation: (flakeRaw.recommendation as string) || null,
    };

    const pageInventory = {
      pagesTouched,
      drift: computePageDrift(pagesTouched),
    };

    const rootCause = summary.rootCauseAnalysis as { status?: string } | undefined;

    const draft: Omit<EvidenceBundle, 'completeness' | 'risk' | 'artifacts'> & {
      artifacts: EvidenceArtifacts;
    } = {
      schemaVersion: EVIDENCE_BUNDLE_SCHEMA_VERSION,
      runId,
      slug,
      testFile: typeof summary.testFile === 'string' ? summary.testFile : undefined,
      status,
      startedAt: typeof summary.timestamp === 'string' ? summary.timestamp : undefined,
      finishedAt: typeof summary.timestamp === 'string' ? summary.timestamp : undefined,
      durationMs: typeof summary.durationMs === 'number' ? summary.durationMs : undefined,
      executionMode:
        typeof summary.executionMode === 'string' ? summary.executionMode : undefined,
      environment: {
        name: typeof summary.environment === 'string' ? summary.environment : undefined,
      },
      browser: {
        target: typeof browser.target === 'string' ? browser.target : undefined,
        provider:
          typeof provider.provider === 'string'
            ? provider.provider
            : typeof provider.displayName === 'string'
              ? provider.displayName
              : undefined,
        headless: typeof browser.headless === 'boolean' ? browser.headless : undefined,
      },
      timeline,
      assertions,
      locators,
      healing,
      pageInventory,
      codegen,
      llmUsage,
      flake,
      artifacts,
      rootCauseStatus:
        rootCause?.status === 'grounded' || rootCause?.status === 'insufficient_evidence'
          ? rootCause.status
          : undefined,
    };

    const completeness = CompletenessGrader.grade(draft, config.completeness);
    const risk = RiskScorer.score(draft, config.risk);

    artifacts.evidenceBundle = evidenceBundleRel(slug, runId);

    return {
      ...draft,
      artifacts,
      completeness,
      risk,
    };
  }

  public static write(
    bundle: EvidenceBundle,
    options: { writeTimelineExtract?: boolean } = {}
  ): string {
    ensureEvidenceDirs();
    const outPath = evidenceBundlePath(bundle.slug, bundle.runId);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2), 'utf8');

    if (options.writeTimelineExtract !== false) {
      const timelinePath = evidenceStepTimelinePath(bundle.slug, bundle.runId);
      fs.writeFileSync(
        timelinePath,
        JSON.stringify(
          {
            schemaVersion: EVIDENCE_BUNDLE_SCHEMA_VERSION,
            runId: bundle.runId,
            slug: bundle.slug,
            timeline: bundle.timeline,
          },
          null,
          2
        ),
        'utf8'
      );
    }

    return outPath;
  }

  /**
   * Build + write evidence, then patch summary with evidenceRef / risk / completeness.
   */
  public static writeForSlug(
    slug: string,
    options: Omit<BuildEvidenceOptions, 'slug'> = {}
  ): EvidenceBundle | null {
    const config = options.config || resolveEvidenceConfig();
    if (!config.enabled || !config.writeBundle) return null;

    const bundle = EvidenceBundleBuilder.build({ ...options, slug, config });
    const outPath = EvidenceBundleBuilder.write(bundle);

    EvidenceBundleBuilder.patchSummary(slug, bundle, outPath);
    return bundle;
  }

  public static patchSummary(
    slug: string,
    bundle: EvidenceBundle,
    evidencePath: string
  ): void {
    const readPath = resolveSummaryPath(slug);
    if (!fs.existsSync(readPath)) return;
    try {
      const summary = JSON.parse(fs.readFileSync(readPath, 'utf8')) as Record<string, unknown>;
      summary.runId = bundle.runId;
      summary.evidenceRef = path.relative(process.cwd(), evidencePath).replace(/\\/g, '/');
      summary.risk = bundle.risk;
      summary.completeness = bundle.completeness;
      summary.evidence = {
        schemaVersion: bundle.schemaVersion,
        healingCount: bundle.healing.count,
        verifiedLocatorRatio: bundle.locators.verifiedRatio,
        codegenQuality: bundle.codegen.quality || null,
      };
      const artifacts = {
        ...((summary.artifacts as Record<string, unknown>) || {}),
        evidenceBundle: summary.evidenceRef,
      };
      summary.artifacts = artifacts;

      const writePath = canonicalSummaryPath(slug);
      fs.mkdirSync(path.dirname(writePath), { recursive: true });
      fs.writeFileSync(writePath, JSON.stringify(summary, null, 2), 'utf8');
    } catch {
      /* ignore patch failures */
    }
  }

  public static load(slug: string, runId: string): EvidenceBundle | null {
    return readJson<EvidenceBundle>(evidenceBundlePath(slug, runId));
  }
}
