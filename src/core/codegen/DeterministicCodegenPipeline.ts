import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { GeneratedFile } from '../../agents/CodegenAgent';
import { CodegenWriter } from '../CodegenWriter';
import { LLMClient } from '../LLMClient';
import { RepoKnowledgeGraph } from '../knowledge/RepoKnowledgeGraph';
import { resolveExecutionHistoryPath } from '../ReportPaths';
import {
  codegenMetadataPath,
  ensureCodegenDirs,
  planPath,
  tracePath,
  writeLatestPointer,
} from './CodegenPaths';
import { ExecutionTrace, RawExecutionStep } from './ExecutionTrace';
import { CodegenMetadata, GenerationPlan } from './GenerationPlan';
import { PlanBuilder } from './PlanBuilder';
import { TraceBuilder } from './TraceBuilder';
import { ReportCodegenInfo } from '../execution_report/types';
import { CodegenProfileRegistry } from './profiles/CodegenProfileRegistry';
import { AssertionRanker } from '../assertions/AssertionRanker';

export interface PipelineInput {
  scenario: string;
  scenarioSlug: string;
  sourceFile?: string;
  steps: RawExecutionStep[];
  targetUrl?: string;
}

export interface PipelineResult {
  trace: ExecutionTrace;
  plan: GenerationPlan;
  files: GeneratedFile[];
  metadata: CodegenMetadata;
}

function profileKey(plan: GenerationPlan): string {
  const { language, automationTool, frameworkPattern } = plan.profile;
  return `${language}-${automationTool}-${frameworkPattern}`;
}

function loadHistorySteps(slug: string): { steps: RawExecutionStep[]; scenario?: string; sourceFile?: string } | null {
  const historyFile = resolveExecutionHistoryPath(slug);
  if (!fs.existsSync(historyFile)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    const steps = (raw.executionHistory || raw.steps || []) as RawExecutionStep[];
    return {
      steps,
      scenario: raw.scenario || raw.testName || slug,
      sourceFile: raw.sourceFile,
    };
  } catch {
    return null;
  }
}

export class DeterministicCodegenPipeline {
  public static buildTraceAndPlan(input: PipelineInput): { trace: ExecutionTrace; plan: GenerationPlan } {
    const trace = TraceBuilder.build(input);
    const plan = PlanBuilder.build(trace);
    return { trace, plan };
  }

  public static generateDeterministicFiles(trace: ExecutionTrace, plan: GenerationPlan): GeneratedFile[] {
    return CodegenProfileRegistry.resolve(plan.profile).emit(trace, plan);
  }

  public static persist(
    trace: ExecutionTrace,
    plan: GenerationPlan,
    files: GeneratedFile[] = []
  ): CodegenMetadata {
    ensureCodegenDirs();
    const slug = trace.scenarioSlug;
    const traceFile = tracePath(slug);
    const planFile = planPath(slug);
    const metadataFile = codegenMetadataPath(slug);
    const profile = CodegenProfileRegistry.resolve(plan.profile);
    const pageObjectPaths = plan.pageObjects.map((page) => page.path);
    const generatedFiles = files.map((file) => file.path);
    const assertionSummary = AssertionRanker.summarize(trace.steps);

    fs.writeFileSync(traceFile, JSON.stringify(trace, null, 2), 'utf8');
    fs.writeFileSync(planFile, JSON.stringify(plan, null, 2), 'utf8');

    const metadata: CodegenMetadata = {
      generatedBy: 'webpilot',
      scenarioSlug: slug,
      sourceTrace: path.relative(process.cwd(), traceFile),
      sourcePlan: path.relative(process.cwd(), planFile),
      profile: profileKey(plan),
      specPath: plan.specPath,
      pageObjectPaths,
      generatedFiles,
      replayCommand: profile.replayCommand(plan.specPath),
      validationCommand: profile.validationCommand(plan.profile),
      assertionSummary,
      updatedAt: new Date().toISOString(),
      mode: 'deterministic',
    };
    fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2), 'utf8');
    writeLatestPointer(slug, metadata.sourceTrace, metadata.sourcePlan);
    return metadata;
  }

  public static toReportCodegen(metadata: CodegenMetadata, plan: GenerationPlan): ReportCodegenInfo {
    return {
      mode: metadata.mode,
      specPath: plan.specPath,
      pageObjectPaths: metadata.pageObjectPaths || plan.pageObjects.map((page) => page.path),
      metadataPath: path.relative(process.cwd(), codegenMetadataPath(metadata.scenarioSlug)),
      tracePath: metadata.sourceTrace,
      planPath: metadata.sourcePlan,
      replayCommand: metadata.replayCommand || `webpilot replay ${plan.specPath}`,
      validationCommand: metadata.validationCommand,
      assertionSummary: metadata.assertionSummary,
      generatedFiles: metadata.generatedFiles || [],
    };
  }

  public static fromSlug(slug: string, scenario?: string, sourceFile?: string): PipelineInput | null {
    const loaded = loadHistorySteps(slug);
    if (!loaded || loaded.steps.length === 0) return null;
    return {
      scenario: scenario || loaded.scenario || slug,
      scenarioSlug: slug,
      sourceFile: sourceFile || loaded.sourceFile,
      steps: loaded.steps,
      targetUrl: loaded.steps.find((step) => step.url)?.url || undefined,
    };
  }

  private static validateProfileFiles(plan: GenerationPlan, files: GeneratedFile[]): void {
    const profile = CodegenProfileRegistry.resolve(plan.profile);
    if (profile.language === 'typescript' && profile.automationTool === 'playwright') return;
    const command = profile.validationCommand(plan.profile);
    if (!command) return;
    execSync(command, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: '/bin/sh',
      env: process.env,
    });
  }

  public static async run(input: PipelineInput, options?: { validate?: boolean }): Promise<PipelineResult> {
    await RepoKnowledgeGraph.refreshAsync();
    const { trace, plan } = DeterministicCodegenPipeline.buildTraceAndPlan(input);
    const files = DeterministicCodegenPipeline.generateDeterministicFiles(trace, plan);
    const metadata = DeterministicCodegenPipeline.persist(trace, plan, files);

    const profile = CodegenProfileRegistry.resolve(plan.profile);
    if (options?.validate === false) {
      CodegenWriter.writeFiles(files);
    } else if (profile.language === 'typescript' && profile.automationTool === 'playwright') {
      const llm = new LLMClient();
      const { ok, paths } = await CodegenWriter.writeAndValidate(files, llm, {
        testSlug: trace.scenarioSlug,
        urls: [...new Set(trace.steps.map((step) => step.url).filter(Boolean) as string[])],
      });
      if (!ok) {
        throw new Error(`Generated code failed validation for ${paths.join(', ')}`);
      }
    } else {
      CodegenWriter.writeFiles(files);
      DeterministicCodegenPipeline.validateProfileFiles(plan, files);
    }

    return { trace, plan, files, metadata };
  }

  public static async runFromSlug(
    slug: string,
    options?: { validate?: boolean; scenario?: string; sourceFile?: string }
  ): Promise<PipelineResult> {
    const input = DeterministicCodegenPipeline.fromSlug(slug, options?.scenario, options?.sourceFile);
    if (!input) {
      throw new Error(`No execution history found for slug "${slug}"`);
    }
    return DeterministicCodegenPipeline.run(input, options);
  }

  public static planSummary(plan: GenerationPlan): string {
    const lines = [
      `Profile: ${plan.profile.language}/${plan.profile.automationTool}/${plan.profile.frameworkPattern}`,
      `Spec: ${plan.specPath}`,
      'Files:',
      ...plan.files.map((file) => `- ${file.operation.toUpperCase()} ${file.path} (${file.reason})`),
    ];
    if (plan.notes.length > 0) lines.push(...plan.notes.map((note) => `Note: ${note}`));
    return lines.join('\n');
  }
}
