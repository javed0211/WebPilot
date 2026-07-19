import * as fs from 'fs';
import * as path from 'path';
import { ADO_RUNTIME_DIR, PROJECT_ROOT } from '../../core/ProjectPaths';
import { resolveSummaryPath } from '../../core/ReportPaths';
import { AdoRestClient } from './AdoRestClient';
import { AdoTestMap } from './AdoTestMap';
import { loadAdoConfig } from './AdoConfig';
import { AdoConfig, AdoPublishResult } from './types';

function mapOutcome(status: string | undefined): 'Passed' | 'Failed' | 'NotExecuted' {
  const s = String(status || '').toUpperCase();
  if (s === 'PASSED' || s === 'PASS') return 'Passed';
  if (s === 'FAILED' || s === 'FAIL' || s === 'ERROR') return 'Failed';
  return 'NotExecuted';
}

interface SummaryEvidence {
  status?: string;
  test?: string;
  path: string;
  riskLevel?: string;
  riskScore?: number;
  completenessGrade?: string;
  completenessScore?: number;
  evidenceRef?: string;
  evidenceAbsPath?: string;
  healingCount?: number;
  codegenQuality?: string | null;
}

function readSummaryEvidence(slugOrPath: string): SummaryEvidence {
  const asPath = path.isAbsolute(slugOrPath)
    ? slugOrPath
    : fs.existsSync(path.join(PROJECT_ROOT, slugOrPath))
      ? path.join(PROJECT_ROOT, slugOrPath)
      : resolveSummaryPath(slugOrPath);
  if (!fs.existsSync(asPath)) {
    return { path: asPath };
  }
  try {
    const summary = JSON.parse(fs.readFileSync(asPath, 'utf8')) as {
      status?: string;
      test?: string;
      risk?: { level?: string; score?: number };
      completeness?: { grade?: string; score?: number };
      evidenceRef?: string;
      evidence?: { healingCount?: number; codegenQuality?: string | null };
      artifacts?: { evidenceBundle?: string };
    };
    const evidenceRef = summary.evidenceRef || summary.artifacts?.evidenceBundle;
    const evidenceAbsPath = evidenceRef
      ? path.isAbsolute(evidenceRef)
        ? evidenceRef
        : path.join(PROJECT_ROOT, evidenceRef)
      : undefined;
    return {
      status: summary.status,
      test: summary.test,
      path: asPath,
      riskLevel: summary.risk?.level,
      riskScore: summary.risk?.score,
      completenessGrade: summary.completeness?.grade,
      completenessScore: summary.completeness?.score,
      evidenceRef,
      evidenceAbsPath:
        evidenceAbsPath && fs.existsSync(evidenceAbsPath) ? evidenceAbsPath : undefined,
      healingCount: summary.evidence?.healingCount,
      codegenQuality: summary.evidence?.codegenQuality,
    };
  } catch {
    return { path: asPath };
  }
}

function formatEvidenceComment(summary: SummaryEvidence): string {
  const bits: string[] = [];
  if (summary.riskLevel != null) {
    bits.push(
      `risk ${summary.riskLevel}${summary.riskScore != null ? ` (${summary.riskScore})` : ''}`
    );
  }
  if (summary.completenessGrade != null) {
    bits.push(
      `completeness ${summary.completenessGrade}${
        summary.completenessScore != null ? ` (${summary.completenessScore})` : ''
      }`
    );
  }
  if (typeof summary.healingCount === 'number') {
    bits.push(`healed ${summary.healingCount}`);
  }
  if (summary.codegenQuality) {
    bits.push(`codegen ${summary.codegenQuality}`);
  }
  const body = bits.length ? bits.join(', ') : 'no risk/completeness on summary';
  let out = `WebPilot evidence: ${body}.`;
  if (summary.evidenceRef) {
    out += `\nEvidence artifact: ${summary.evidenceRef}`;
  }
  return out;
}

export interface PublishOptions {
  /** Explicit summary file or slug. When omitted, publish all mapped tests with summaries. */
  summary?: string;
  runName?: string;
  dryRun?: boolean;
  /** Local run id for idempotency under runtime/ado/. */
  runId?: string;
}

export class AdoResultPublisher {
  public constructor(private readonly config: AdoConfig = loadAdoConfig()) {}

  public async publishFromSummaries(options: PublishOptions = {}): Promise<AdoPublishResult> {
    const mapped = AdoTestMap.list();
    if (mapped.length === 0) {
      throw new Error(
        `No ADO test mappings found. Run webpilot ado link or ado sync-cases first (${AdoTestMap.path()}).`
      );
    }

    const outcomes: AdoPublishResult['outcomes'] = [];
    let skipped = 0;
    const evidenceByCase = new Map<number, SummaryEvidence>();

    const targets = options.summary
      ? mapped.filter((row) => {
          const slug = path.basename(row.path, path.extname(row.path));
          return (
            row.path.includes(options.summary!) ||
            slug === options.summary ||
            resolveSummaryPath(slug).includes(options.summary!)
          );
        })
      : mapped;

    if (targets.length === 0) {
      throw new Error(`No mapped tests matched summary filter: ${options.summary}`);
    }

    for (const row of targets) {
      const slug = path.basename(row.path, path.extname(row.path));
      const summary = readSummaryEvidence(slug);
      if (!summary.status) {
        skipped += 1;
        continue;
      }
      evidenceByCase.set(row.entry.testCaseId, summary);
      outcomes.push({
        path: row.path,
        testCaseId: row.entry.testCaseId,
        outcome: mapOutcome(summary.status),
      });
    }

    if (options.dryRun) {
      return { published: outcomes.length, skipped, outcomes, dryRun: true };
    }

    if (outcomes.length === 0) {
      return { published: 0, skipped, outcomes, dryRun: false };
    }

    const rest = new AdoRestClient(this.config);
    const planId = targets.find((t) => t.entry.testPlanId)?.entry.testPlanId;
    const suiteId = targets.find((t) => t.entry.testSuiteId)?.entry.testSuiteId;

    let pointByCase = new Map<number, number>();
    if (planId && suiteId) {
      try {
        const points = await rest.getPoints(planId, suiteId);
        pointByCase = new Map(
          points
            .map((p) => [Number(p.testCase?.id), p.id] as [number, number])
            .filter(([id]) => Number.isFinite(id))
        );
      } catch {
        // Point lookup is best-effort; results can still be posted with testCase title refs.
      }
    }

    const runName =
      options.runName ||
      `WebPilot ${options.runId || new Date().toISOString().replace(/[:.]/g, '-')}`;

    const pointIds = outcomes
      .map((o) => pointByCase.get(o.testCaseId))
      .filter((id): id is number => typeof id === 'number');

    const run = await rest.createTestRun({
      name: runName,
      plan: planId ? { id: planId } : undefined,
      pointIds: pointIds.length ? pointIds : undefined,
      automated: true,
      state: 'InProgress',
    });

    const results = outcomes.map((o) => {
      const pointId = pointByCase.get(o.testCaseId);
      const summary = evidenceByCase.get(o.testCaseId);
      const row: Record<string, unknown> = {
        testCase: { id: String(o.testCaseId) },
        testCaseTitle: AdoTestMap.findByTestCaseId(o.testCaseId)?.entry.title || o.path,
        automatedTestName:
          AdoTestMap.findByTestCaseId(o.testCaseId)?.entry.automatedTestName ||
          path.basename(o.path, path.extname(o.path)),
        outcome: o.outcome,
        state: 'Completed',
        comment: summary ? formatEvidenceComment(summary) : 'Published by WebPilot',
      };
      if (pointId) row.testPoint = { id: pointId };
      return row;
    });

    const created = await rest.addTestResults(run.id, results);

    // Attach EvidenceBundle JSON when available (best-effort).
    for (const createdResult of created) {
      const caseId = Number(createdResult.testCase?.id);
      if (!Number.isFinite(caseId) || !createdResult.id) continue;
      const summary = evidenceByCase.get(caseId);
      if (!summary?.evidenceAbsPath) continue;
      try {
        const content = fs.readFileSync(summary.evidenceAbsPath);
        await rest.createTestResultAttachment(
          run.id,
          createdResult.id,
          path.basename(summary.evidenceAbsPath),
          content,
          formatEvidenceComment(summary)
        );
      } catch (err) {
        console.warn(
          `[ado] evidence attachment skipped for test case ${caseId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    const withEvidence = [...evidenceByCase.values()].filter((s) => s.evidenceRef).length;
    const runComment =
      withEvidence > 0
        ? `Published by WebPilot — ${withEvidence}/${outcomes.length} result(s) include EvidenceBundle refs.`
        : 'Published by WebPilot';
    await rest.updateTestRun(run.id, { state: 'Completed', comment: runComment });

    this.recordPublish(options.runId || String(run.id), {
      runId: run.id,
      publishedAt: new Date().toISOString(),
      outcomes,
      evidenceAttached: withEvidence,
    });

    return {
      runId: run.id,
      published: outcomes.length,
      skipped,
      outcomes,
      dryRun: false,
    };
  }

  /**
   * Best-effort auto-publish after a local run. Never throws unless strict.
   */
  public static async maybeAutoPublish(slug: string, strict = false): Promise<void> {
    const config = loadAdoConfig();
    if (!config.enabled || !config.testPlans?.autoPublishResults) return;
    try {
      const publisher = new AdoResultPublisher(config);
      await publisher.publishFromSummaries({ summary: slug, runId: `${slug}-${Date.now()}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (strict) throw err;
      console.warn(`[ado] auto-publish skipped: ${msg}`);
    }
  }

  private recordPublish(runId: string, payload: unknown): void {
    fs.mkdirSync(ADO_RUNTIME_DIR, { recursive: true });
    const file = path.join(ADO_RUNTIME_DIR, `publish-${runId}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  }
}

/** Exported for unit tests. */
export const __test = { formatEvidenceComment, readSummaryEvidence, mapOutcome };
