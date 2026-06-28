import * as fs from 'fs';
import { FlakeAnalysis, FlakeAnalysisInput } from './FailureSignal';
import { FailureSignalExtractor } from './FailureSignalExtractor';
import { FlakeClassifier } from './FlakeClassifier';
import { FlakeRecommendation } from './FlakeRecommendation';
import { resolveExecutionHistoryPath, resolveSummaryPath } from '../ReportPaths';
import { TestCaseReport } from '../execution_report/types';

function evidenceFromInput(input: FlakeAnalysisInput): FlakeAnalysis['evidence'] {
  const evidence: FlakeAnalysis['evidence'] = [];
  const artifacts = input.artifacts;

  if (artifacts?.trace) evidence.push({ label: 'Playwright trace', href: artifacts.trace });
  if (artifacts?.video) evidence.push({ label: 'Execution video', href: artifacts.video });
  for (const shot of artifacts?.screenshots?.slice(0, 3) || []) {
    evidence.push({ label: 'Screenshot', href: shot });
  }

  return evidence;
}

export class FlakeAnalyzer {
  public static analyze(input: FlakeAnalysisInput): FlakeAnalysis | null {
    if (input.status === 'PASSED') return null;

    const signals = FailureSignalExtractor.extract(input);
    const classification = FlakeClassifier.classify(signals, input.failureContext);
    const recommendation = FlakeRecommendation.build({
      category: classification.category,
      signals,
    });

    return {
      category: classification.category,
      confidence: classification.confidence,
      likelyCause: classification.likelyCause,
      recommendation,
      signals,
      evidence: evidenceFromInput(input),
      source: classification.source,
    };
  }

  public static analyzeTestCase(test: TestCaseReport, failureContext?: string): FlakeAnalysis | null {
    return FlakeAnalyzer.analyze({
      slug: test.slug,
      status: test.status,
      failureContext,
      executionSteps: test.executionSteps,
      runtimeInsights: test.runtimeInsights,
      artifacts: test.artifacts,
    });
  }

  public static analyzeSlug(slug: string): FlakeAnalysis | null {
    const summaryPath = resolveSummaryPath(slug);
    if (!fs.existsSync(summaryPath)) return null;
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as Record<string, unknown>;
    const ctxPath = resolveExecutionHistoryPath(slug);
    let ctx: Record<string, unknown> | null = null;
    if (fs.existsSync(ctxPath)) {
      try {
        ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf8')) as Record<string, unknown>;
      } catch {
        ctx = null;
      }
    }

    const artifactsRaw = (summary.artifacts as Record<string, string>) || {};
    const insights =
      ((ctx?.runtimeInsights as { insights?: { type?: string; message?: string }[] })?.insights) || [];

    return FlakeAnalyzer.analyze({
      slug,
      status: String(summary.status ?? 'UNKNOWN'),
      failureContext:
        typeof summary.failureContext === 'string' ? summary.failureContext : undefined,
      executionSteps: ((ctx?.executionHistory as FlakeAnalysisInput['executionSteps']) || []).slice(
        0,
        80
      ),
      runtimeInsights: insights,
      artifacts: {
        video: artifactsRaw.video,
        trace: artifactsRaw.trace,
        screenshots: Array.isArray((summary.artifacts as { screenshots?: string[] })?.screenshots)
          ? ((summary.artifacts as { screenshots?: string[] }).screenshots as string[])
          : [],
      },
    });
  }

  public static persist(slug: string, analysis: FlakeAnalysis): void {
    const summaryPath = resolveSummaryPath(slug);
    if (!fs.existsSync(summaryPath)) return;
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as Record<string, unknown>;
    summary.flakeAnalysis = analysis;
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  }
}
