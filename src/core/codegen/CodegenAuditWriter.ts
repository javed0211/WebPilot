import * as fs from 'fs';
import * as path from 'path';
import { auditPath, ensureCodegenDirs } from './CodegenPaths';
import { ExecutionTrace, RawExecutionStep } from './ExecutionTrace';
import { GenerationPlan } from './GenerationPlan';
import { pageForStep } from './PageMapping';
import { SpecWriteDiagnostics } from './DeterministicSpecWriter';

export type CodegenQuality = 'good' | 'degraded';

export interface CodegenAudit {
  scenarioSlug: string;
  generatedAt: string;
  totalHistorySteps: number;
  traceSteps: number;
  stepsWithUrl: number;
  stepsWithPageCandidate: number;
  stepsWithSelector: number;
  stepsWithLocators: number;
  plannedPageObjects: number;
  mappedPomSteps: number;
  mappedPomStepIndexes: number[];
  qualityEligibleSteps: number;
  mappedQualityEligibleSteps: number;
  pomMappedStepRatio: number;
  unmappedSteps: number;
  unmappedStepIndexes: number[];
  qualityUnmappedStepIndexes: number[];
  auxiliaryUnmappedStepIndexes: number[];
  rawFallbackUsed: boolean;
  rawFallbackStepIndexes: number[];
  qualityRawFallbackStepIndexes: number[];
  omittedStepIndexes: number[];
  quality: CodegenQuality;
  qualityReasons: string[];
}

function hasLocators(step: RawExecutionStep): boolean {
  if (step.locators?.length) return true;
  const selector = step.selector?.trim();
  if (!selector?.startsWith('[')) return false;
  try {
    const parsed = JSON.parse(selector);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

export class CodegenAuditWriter {
  public static build(
    historySteps: RawExecutionStep[],
    trace: ExecutionTrace,
    plan: GenerationPlan,
    diagnostics?: SpecWriteDiagnostics
  ): CodegenAudit {
    const contextualMappings = trace.steps
      .filter((step) => pageForStep(step, plan.pageObjects, trace))
      .map((step) => step.index);
    const mappedPomStepIndexes = diagnostics?.mappedPomStepIndexes ?? contextualMappings;
    const unmappedStepIndexes = diagnostics?.unmappedStepIndexes ??
      trace.steps.filter((step) => !contextualMappings.includes(step.index)).map((step) => step.index);
    const rawFallbackUsed = diagnostics?.rawFallbackUsed || false;
    const eligibleIndexes = trace.steps
      .filter((step) => !['wait', 'screenshot', 'custom'].includes(step.action))
      .map((step) => step.index);
    const eligible = new Set(eligibleIndexes);
    const mappedQualityEligibleSteps = mappedPomStepIndexes.filter((index) => eligible.has(index)).length;
    const pomMappedStepRatio = eligibleIndexes.length
      ? mappedQualityEligibleSteps / eligibleIndexes.length
      : 1;
    const qualityUnmappedStepIndexes = unmappedStepIndexes.filter((index) => eligible.has(index));
    const auxiliaryUnmappedStepIndexes = unmappedStepIndexes.filter((index) => !eligible.has(index));
    const qualityRawFallbackStepIndexes = (diagnostics?.rawFallbackStepIndexes || [])
      .filter((index) => eligible.has(index));
    const qualityReasons: string[] = [];

    if (plan.pageObjects.length === 0) qualityReasons.push('No page objects were planned.');
    if (mappedQualityEligibleSteps === 0 && eligibleIndexes.length > 0) {
      qualityReasons.push('No quality-eligible trace steps mapped to POM methods.');
    }
    if (qualityUnmappedStepIndexes.length > 0) {
      qualityReasons.push(`${qualityUnmappedStepIndexes.length} quality-eligible step(s) were not mapped to POM methods.`);
    }
    if (qualityRawFallbackStepIndexes.length > 0) {
      qualityReasons.push('Raw Playwright fallback was emitted for quality-eligible steps.');
    }
    if (trace.steps.length === 0) qualityReasons.push('The execution trace is empty.');

    return {
      scenarioSlug: trace.scenarioSlug,
      generatedAt: new Date().toISOString(),
      totalHistorySteps: historySteps.length,
      traceSteps: trace.steps.length,
      stepsWithUrl: trace.steps.filter((step) => Boolean(step.url)).length,
      stepsWithPageCandidate: trace.steps.filter((step) => Boolean(step.pageCandidate)).length,
      stepsWithSelector: trace.steps.filter((step) => Boolean(step.selector)).length,
      stepsWithLocators: historySteps.filter(hasLocators).length,
      plannedPageObjects: plan.pageObjects.length,
      mappedPomSteps: mappedPomStepIndexes.length,
      mappedPomStepIndexes,
      qualityEligibleSteps: eligibleIndexes.length,
      mappedQualityEligibleSteps,
      pomMappedStepRatio: Number(pomMappedStepRatio.toFixed(4)),
      unmappedSteps: unmappedStepIndexes.length,
      unmappedStepIndexes,
      qualityUnmappedStepIndexes,
      auxiliaryUnmappedStepIndexes,
      rawFallbackUsed,
      rawFallbackStepIndexes: diagnostics?.rawFallbackStepIndexes || [],
      qualityRawFallbackStepIndexes,
      omittedStepIndexes: diagnostics?.omittedStepIndexes || [],
      quality: qualityReasons.length === 0 ? 'good' : 'degraded',
      qualityReasons,
    };
  }

  public static write(
    historySteps: RawExecutionStep[],
    trace: ExecutionTrace,
    plan: GenerationPlan,
    diagnostics?: SpecWriteDiagnostics
  ): CodegenAudit {
    ensureCodegenDirs();
    const audit = CodegenAuditWriter.build(historySteps, trace, plan, diagnostics);
    fs.writeFileSync(auditPath(trace.scenarioSlug), JSON.stringify(audit, null, 2), 'utf8');
    return audit;
  }

  public static relativePath(slug: string): string {
    return path.relative(process.cwd(), auditPath(slug));
  }
}
