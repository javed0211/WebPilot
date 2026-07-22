import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { GeneratedFile } from '../../agents/CodegenAgent';
import { CodegenWriter } from '../CodegenWriter';
import { LLMClient } from '../LLMClient';
import { RepoKnowledgeGraph } from '../knowledge/RepoKnowledgeGraph';
import { resolveCodegenArchitecture } from '../knowledge/RepoArchitectureDetect';
import { ActHistoryCodegenAdapter } from './ActHistoryCodegenAdapter';
import {
  codegenMetadataPath,
  ensureCodegenDirs,
  planPath,
  tracePath,
  writeLatestPointer,
} from './CodegenPaths';
import { CodegenAuditWriter } from './CodegenAuditWriter';
import { DeterministicSpecWriter } from './DeterministicSpecWriter';
import { ExecutionTrace, RawExecutionStep } from './ExecutionTrace';
import { CodegenMetadata, GenerationPlan } from './GenerationPlan';
import { PlanBuilder } from './PlanBuilder';
import { TraceBuilder } from './TraceBuilder';
import { ReportCodegenInfo } from '../execution_report/types';
import { CodegenProfileRegistry } from './profiles/CodegenProfileRegistry';
import { AssertionRanker } from '../assertions/AssertionRanker';
import { ensurePythonPlaywrightFramework, readProjectName } from '../PythonFrameworkTemplates';
import { ensureJavaSeleniumFramework, readJavaProjectName } from '../JavaFrameworkTemplates';
import { ensureCypressFramework, ensureCypressTsConfig } from '../CypressFrameworkTemplates';
import {
  ensureCsharpPlaywrightFramework,
  ensureCsharpSeleniumFramework,
} from '../CsharpFrameworkTemplates';
import { ensureWebdriverIOFramework, ensureWdioTsConfig } from '../WebdriverIOFrameworkTemplates';
import { CodegenAgent } from '../../agents/CodegenAgent';
import { CodegenFailureMemory } from './CodegenFailureMemory';
import { fingerprintHistoryFile } from './HistoryReuse';
import { resolveExecutionHistoryPath } from '../ReportPaths';
import { WriteAndValidateResult } from '../CodegenWriter';
import { CodegenContext } from '../CodegenContext';
import { Logger } from '../../utils/Logger';
import { ConfigManager } from '../ConfigManager';
import { enforceCodegenQuality } from './CodegenQualityPolicy';

function formatValidationFailure(validation: WriteAndValidateResult): string {
  const parts = [
    `Validation failed for: ${validation.paths.join(', ') || '(unknown files)'}`,
    validation.tsIssues?.length ? `TypeScript issues:\n${validation.tsIssues.slice(0, 20).join('\n')}` : '',
    validation.referenceIssues?.length
      ? `Reference issues:\n${validation.referenceIssues.slice(0, 12).join('\n')}`
      : '',
    validation.playwrightOutput
      ? `Playwright failure (tail):\n${validation.playwrightOutput.slice(-5000)}`
      : '',
  ].filter(Boolean);
  return parts.join('\n\n');
}

export interface PipelineInput {
  scenario: string;
  scenarioSlug: string;
  sourceFile?: string;
  steps: RawExecutionStep[];
  targetUrl?: string;
  historySource?: string;
  symbolGraphContext?: string;
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

function loadHistorySteps(slug: string): PipelineInput | null {
  const loaded = ActHistoryCodegenAdapter.loadFromSlug(slug);
  if (!loaded) return null;
  return {
    scenario: loaded.scenario,
    scenarioSlug: loaded.scenarioSlug,
    sourceFile: loaded.sourceFile,
    steps: loaded.steps,
    targetUrl: loaded.targetUrl,
    historySource: loaded.historySource,
  };
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
      ...loaded,
      scenario: scenario || loaded.scenario || slug,
      sourceFile: sourceFile || loaded.sourceFile,
    };
  }

  private static validateProfileFiles(plan: GenerationPlan, _files: GeneratedFile[]): void {
    const profile = CodegenProfileRegistry.resolve(plan.profile);
    if (profile.language === 'typescript' && profile.automationTool === 'playwright') return;
    const command = profile.validationCommand(plan.profile);
    if (!command) return;
    try {
      execSync(command, {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: process.env,
      });
      console.log(`[Codegen] Profile validation passed (${profile.language}/${profile.automationTool}).`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Generated code failed validation for ${profile.language}/${profile.automationTool}: ${message}`
      );
    }
  }

  private static ensureProfileScaffold(plan: GenerationPlan): void {
    const { language, automationTool } = plan.profile;
    if (language === 'python' && automationTool === 'playwright') {
      const written = ensurePythonPlaywrightFramework(process.cwd(), readProjectName());
      if (written.length > 0) {
        console.log(
          `[Codegen] Scaffolded Python Playwright framework (${written.length} file(s)): ${written.join(', ')}`
        );
      }
      return;
    }
    if (language === 'java' && automationTool === 'selenium') {
      const written = ensureJavaSeleniumFramework(process.cwd(), readJavaProjectName());
      if (written.length > 0) {
        console.log(
          `[Codegen] Scaffolded Java Selenium framework (${written.length} file(s)): ${written.join(', ')}`
        );
      }
      return;
    }
    if (language === 'typescript' && automationTool === 'cypress') {
      if (ensureCypressTsConfig()) {
        console.log('[Codegen] Wrote tsconfig.json with Cypress types.');
      }
      const written = ensureCypressFramework();
      if (written.length > 0) {
        console.log(
          `[Codegen] Scaffolded Cypress framework (${written.length} file(s)): ${written.join(', ')}`
        );
      }
      return;
    }
    if (language === 'csharp' && automationTool === 'selenium') {
      const written = ensureCsharpSeleniumFramework();
      if (written.length > 0) {
        console.log(
          `[Codegen] Scaffolded C# Selenium framework (${written.length} file(s)): ${written.join(', ')}`
        );
      }
      return;
    }
    if (language === 'csharp' && automationTool === 'playwright') {
      const written = ensureCsharpPlaywrightFramework();
      if (written.length > 0) {
        console.log(
          `[Codegen] Scaffolded C# Playwright framework (${written.length} file(s)): ${written.join(', ')}`
        );
      }
      return;
    }
    if (language === 'typescript' && automationTool === 'webdriverio') {
      if (ensureWdioTsConfig()) {
        console.log('[Codegen] Wrote tsconfig.json with WebdriverIO types.');
      }
      const written = ensureWebdriverIOFramework();
      if (written.length > 0) {
        console.log(
          `[Codegen] Scaffolded WebdriverIO framework (${written.length} file(s)): ${written.join(', ')}`
        );
      }
    }
  }

  public static async run(input: PipelineInput, options?: { validate?: boolean; agentRepair?: boolean }): Promise<PipelineResult> {
    await RepoKnowledgeGraph.refreshAsync();
    const graphContext =
      input.symbolGraphContext || CodegenContext.buildSymbolGraphContext();
    const { trace, plan } = DeterministicCodegenPipeline.buildTraceAndPlan(input);
    if (input.historySource) {
      plan.notes.push(`History source: ${input.historySource}`);
    }

    let files = DeterministicCodegenPipeline.generateDeterministicFiles(trace, plan);
    let codegenAudit: ReturnType<typeof CodegenAuditWriter.build> | undefined;
    try {
      codegenAudit = CodegenAuditWriter.write(
        input.steps,
        trace,
        plan,
        DeterministicSpecWriter.diagnosticsFor(plan)
      );
      Logger.detail(
        `Codegen audit: ${codegenAudit.mappedPomSteps}/${codegenAudit.traceSteps} POM-mapped step(s), ` +
          `${codegenAudit.unmappedSteps} unmapped, raw fallback ${codegenAudit.rawFallbackUsed ? 'used' : 'not used'}, ` +
          `quality ${codegenAudit.quality} (${CodegenAuditWriter.relativePath(trace.scenarioSlug)})`
      );
      if (codegenAudit.quality === 'degraded') {
        Logger.warn(`Codegen audit: DEGRADED — ${codegenAudit.qualityReasons.join(' ')}`);
      }
    } catch (err) {
      Logger.detail(`Codegen audit skipped: ${err instanceof Error ? err.message : err}`);
    }
    if (codegenAudit) {
      const config = ConfigManager.getInstance();
      try {
        enforceCodegenQuality(codegenAudit, {
          allowRawPageFallback: Boolean(
            config.get('framework.codegenQuality.allowRawPageFallback', true)
          ),
          minPomMappedStepRatio: Number(
            config.get('framework.codegenQuality.minPomMappedStepRatio', 0)
          ),
        });
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : error} ` +
            `See ${CodegenAuditWriter.relativePath(trace.scenarioSlug)}.`
        );
      }
    }
    let metadata = DeterministicCodegenPipeline.persist(trace, plan, files);
    metadata = { ...metadata, mode: 'deterministic' };

    const profile = CodegenProfileRegistry.resolve(plan.profile);
    DeterministicCodegenPipeline.ensureProfileScaffold(plan);
    if (options?.validate === false) {
      CodegenWriter.writeFiles(files);
      return { trace, plan, files, metadata };
    }

    if (profile.language === 'typescript' && profile.automationTool === 'playwright') {
      const llm = new LLMClient();
      const validation = await CodegenWriter.writeAndValidate(files, llm, {
        testSlug: trace.scenarioSlug,
        urls: [...new Set(trace.steps.map((step) => step.url).filter(Boolean) as string[])],
      });
      if (!validation.ok) {
        const allowAgentRepair = options?.agentRepair === true;
        const historyFp =
          fingerprintHistoryFile(resolveExecutionHistoryPath(trace.scenarioSlug)) || undefined;
        CodegenFailureMemory.save({
          slug: trace.scenarioSlug,
          updatedAt: new Date().toISOString(),
          paths: validation.paths,
          playwrightOutput: validation.playwrightOutput,
          tsIssues: validation.tsIssues,
          referenceIssues: validation.referenceIssues,
          historyFingerprint: historyFp,
        });
        if (!allowAgentRepair) {
          throw new Error(`Generated code failed validation for ${validation.paths.join(', ')}`);
        }
        Logger.warn(
          `Deterministic codegen validation failed; invoking RepoEditCodegenAgent (Cursor-style read/edit) with repo knowledge graph + prior failure memory.`
        );
        const agent = new CodegenAgent(llm);
        const llmSteps = input.steps.map((step) => ({
          action: step.action,
          selector: step.selector ?? undefined,
          value: step.value ?? undefined,
          url: step.url ?? undefined,
          description: step.description,
        }));
        const failureDetail = formatValidationFailure(validation);
        const prior = CodegenFailureMemory.toPromptBlock(trace.scenarioSlug);
        const detection = resolveCodegenArchitecture({
          override: plan.profile.frameworkPattern,
        });
        const generated = await agent.generateCode(
          input.scenario,
          llmSteps,
          detection.architecture,
          graphContext,
          [failureDetail, prior].filter(Boolean).join('\n\n')
        );
        // The repair agent may edit only page objects. Always re-validate with the
        // spec included, otherwise Playwright validation silently gets skipped and
        // a still-broken repair is reported as PASSED.
        const repairFiles = [...generated.files];
        if (!repairFiles.some((file) => file.path.endsWith('.spec.ts'))) {
          const specOnDisk = path.join(process.cwd(), plan.specPath);
          if (fs.existsSync(specOnDisk)) {
            repairFiles.push({ path: plan.specPath, content: fs.readFileSync(specOnDisk, 'utf8') });
          }
        }
        const repaired = await CodegenWriter.writeAndValidate(repairFiles, llm, {
          testSlug: trace.scenarioSlug,
          urls: [...new Set(input.steps.map((step) => step.url).filter(Boolean) as string[])],
        });
        if (!repaired.ok) {
          CodegenFailureMemory.save({
            slug: trace.scenarioSlug,
            updatedAt: new Date().toISOString(),
            paths: repaired.paths,
            playwrightOutput: repaired.playwrightOutput,
            tsIssues: repaired.tsIssues,
            referenceIssues: repaired.referenceIssues,
            fixReport: generated.fixReport,
            historyFingerprint: historyFp,
          });
          throw new Error(
            `CodegenAgent repair still failed validation for ${repaired.paths.join(', ')}`
          );
        }
        CodegenFailureMemory.clear(trace.scenarioSlug);
        files = generated.files;
        metadata = DeterministicCodegenPipeline.persist(trace, plan, files);
        metadata.mode = 'llm';
        fs.writeFileSync(
          codegenMetadataPath(trace.scenarioSlug),
          JSON.stringify(metadata, null, 2),
          'utf8'
        );
        plan.notes.push('Repaired by RepoEditCodegenAgent (Cursor-style) using ActHistory + repository files');
      } else {
        CodegenFailureMemory.clear(trace.scenarioSlug);
      }
    } else {
      CodegenWriter.writeFiles(files);
      DeterministicCodegenPipeline.validateProfileFiles(plan, files);
    }

    return { trace, plan, files, metadata };
  }

  public static async runFromSlug(
    slug: string,
    options?: { validate?: boolean; scenario?: string; sourceFile?: string; agentRepair?: boolean }
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
