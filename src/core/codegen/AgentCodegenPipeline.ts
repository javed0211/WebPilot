import { LLMClient } from '../LLMClient';
import { CodegenContext } from '../CodegenContext';
import { CodegenWriter } from '../CodegenWriter';
import { CodegenFailureMemory } from './CodegenFailureMemory';
import { RepoKnowledgeGraph } from '../knowledge/RepoKnowledgeGraph';
import { CodegenTools } from '../knowledge/CodegenTools';
import {
  CodegenArchitecture,
  resolveCodegenArchitecture,
} from '../knowledge/RepoArchitectureDetect';
import { CodegenAgent, GeneratedFile } from '../../agents/CodegenAgent';
import { Logger } from '../../utils/Logger';
import {
  DeterministicCodegenPipeline,
  PipelineInput,
  PipelineResult,
} from './DeterministicCodegenPipeline';
import { readProjectCodegenProfile } from './PostExecutionCodegen';
import { CodegenProfileRegistry } from './profiles/CodegenProfileRegistry';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface AgentCodegenOptions {
  validate?: boolean;
  /** Force architecture; otherwise detect from repo layout. */
  architecture?: string;
  /** Run LLM graph enrich before agent loop (fail-soft). */
  enrichGraph?: boolean;
  /** After validate failure, run a second agent repair round. */
  repair?: boolean;
}

function formatValidationFailure(validation: {
  paths: string[];
  playwrightOutput?: string;
  tsIssues?: string[];
  referenceIssues?: string[];
}): string {
  const parts = [
    `Validation failed for: ${validation.paths.join(', ')}`,
    validation.tsIssues?.length ? `TS: ${validation.tsIssues.slice(0, 8).join(' | ')}` : '',
    validation.referenceIssues?.length
      ? `Refs: ${validation.referenceIssues.slice(0, 8).join(' | ')}`
      : '',
    validation.playwrightOutput
      ? `Playwright:\n${validation.playwrightOutput.slice(-3000)}`
      : '',
  ].filter(Boolean);
  return parts.join('\n');
}

function isWeakGotoOnlyScaffold(files: GeneratedFile[]): boolean {
  if (!files.length) return true;
  const joined = files.map((f) => f.content).join('\n');
  const withoutGoto = joined.replace(/\b(goto|navigate|page\.goto)\b/gi, '');
  const hasInteraction = /\b(fill|click|type|select|assert|expect|press|check)\b/i.test(withoutGoto);
  const small = files.every((f) => f.content.length < 900);
  return small && !hasInteraction;
}

/**
 * Repo-aware codegen: knowledge graph tools + coding agent.
 * Language comes from project profile (typescript / python / java / csharp) —
 * not hardcoded to TypeScript.
 */
export class AgentCodegenPipeline {
  public static shouldPreferAgent(graphPages?: number): boolean {
    if (process.env.WEBPILOT_CODEGEN_DETERMINISTIC === '1') return false;
    if (process.env.WEBPILOT_CODEGEN_AGENT === '1') return true;
    const pages =
      graphPages ??
      RepoKnowledgeGraph.load()?.stats.pages ??
      RepoKnowledgeGraph.build().stats.pages;
    return pages > 0;
  }

  public static async run(
    input: PipelineInput,
    options: AgentCodegenOptions = {}
  ): Promise<PipelineResult> {
    const enrich = options.enrichGraph !== false;
    const profile = readProjectCodegenProfile();
    const graph = await RepoKnowledgeGraph.refreshAsync(undefined, { enrich });
    const tools = new CodegenTools(undefined, graph, profile);
    const detection = resolveCodegenArchitecture({
      override: options.architecture,
    });
    const architecture = detection.architecture;
    Logger.info(
      `[AgentCodegen] lang=${profile.language}/${profile.automationTool} architecture=${architecture} (${detection.confidence}): ${detection.reasons.join('; ')}`
    );

    const llm = new LLMClient({ maxTokens: 16000 });
    const agent = new CodegenAgent(llm);
    const llmSteps = input.steps.map((step) => ({
      action: step.action,
      selector: step.selector ?? undefined,
      value: step.value ?? undefined,
      url: step.url ?? undefined,
      description: step.description,
    }));

    const graphContext = CodegenContext.buildSymbolGraphContext();
    let generated = await agent.generateCode(
      input.scenario,
      llmSteps,
      architecture,
      graphContext
    );

    let files = generated.files;
    const priorFiles = [...files];

    const { trace, plan } = DeterministicCodegenPipeline.buildTraceAndPlan({
      ...input,
    });
    plan.profile = {
      ...plan.profile,
      language: profile.language,
      automationTool: profile.automationTool,
      frameworkPattern: detection.frameworkPattern,
      testFramework: profile.testFramework,
    };
    plan.notes.push(
      `Agent codegen: language=${profile.language} architecture=${architecture} confidence=${detection.confidence}`
    );
    plan.notes.push(...detection.reasons.map((r) => `Architecture: ${r}`));

    let metadata = DeterministicCodegenPipeline.persist(trace, plan, files);
    metadata = { ...metadata, mode: 'llm' as const };

    if (options.validate === false) {
      CodegenWriter.writeFiles(files);
      return { trace, plan, files, metadata };
    }

    const isTsPlaywright =
      profile.language === 'typescript' && profile.automationTool === 'playwright';

    if (!isTsPlaywright) {
      CodegenWriter.writeFiles(files);
      const adapter = CodegenProfileRegistry.resolve(plan.profile);
      const command = adapter.validationCommand?.(plan.profile);
      if (command) {
        try {
          execSync(command, { cwd: process.cwd(), stdio: 'inherit', env: process.env });
          Logger.info(`[AgentCodegen] Profile validation passed (${profile.language}/${profile.automationTool})`);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (options.repair === false) {
            throw new Error(`Agent codegen failed ${profile.language} validation: ${message}`);
          }
          Logger.warn(`[AgentCodegen] ${profile.language} validation failed — running repair`);
          generated = await agent.generateCode(
            input.scenario,
            llmSteps,
            architecture,
            graphContext,
            message
          );
          if (!isWeakGotoOnlyScaffold(generated.files)) {
            files = generated.files;
            CodegenWriter.writeFiles(files);
          } else {
            Logger.warn('[AgentCodegen] Repair returned weak scaffold — keeping prior files');
            files = priorFiles;
            CodegenWriter.writeFiles(files);
          }
        }
      }
      metadata = DeterministicCodegenPipeline.persist(trace, plan, files);
      metadata = { ...metadata, mode: 'llm' };
      return { trace, plan, files, metadata };
    }

    let validation = await CodegenWriter.writeAndValidate(files, llm, {
      testSlug: trace.scenarioSlug,
      urls: [...new Set(trace.steps.map((step) => step.url).filter(Boolean) as string[])],
    });

    if (!validation.ok && options.repair !== false) {
      Logger.warn('[AgentCodegen] Validation failed — running repair tool loop');
      CodegenFailureMemory.save({
        slug: trace.scenarioSlug,
        updatedAt: new Date().toISOString(),
        paths: validation.paths,
        playwrightOutput: validation.playwrightOutput,
        tsIssues: validation.tsIssues,
        referenceIssues: validation.referenceIssues,
      });
      const failureDetail = formatValidationFailure(validation);
      const prior = CodegenFailureMemory.toPromptBlock(trace.scenarioSlug);
      generated = await agent.generateCode(
        input.scenario,
        llmSteps,
        architecture,
        graphContext,
        [failureDetail, prior].filter(Boolean).join('\n\n')
      );

      if (isWeakGotoOnlyScaffold(generated.files) && priorFiles.length) {
        Logger.warn('[AgentCodegen] Repair produced weak goto-only scaffold — keeping prior multi-step files');
        files = [...priorFiles];
      } else {
        files = [...generated.files];
      }

      if (!files.some((file) => /\.(spec|test)\.ts$/i.test(file.path) || file.path === plan.specPath)) {
        const specOnDisk = path.join(process.cwd(), plan.specPath);
        if (fs.existsSync(specOnDisk)) {
          files.push({ path: plan.specPath, content: fs.readFileSync(specOnDisk, 'utf8') });
        }
      }
      validation = await CodegenWriter.writeAndValidate(files, llm, {
        testSlug: trace.scenarioSlug,
        urls: [...new Set(trace.steps.map((step) => step.url).filter(Boolean) as string[])],
      });
      if (!validation.ok) {
        throw new Error(`Agent codegen failed validation for ${validation.paths.join(', ')}`);
      }
    } else if (!validation.ok) {
      throw new Error(`Agent codegen failed validation for ${validation.paths.join(', ')}`);
    }

    metadata = DeterministicCodegenPipeline.persist(trace, plan, files);
    metadata = { ...metadata, mode: 'llm' };
    tools.refreshGraph(RepoKnowledgeGraph.load() ?? undefined);

    return { trace, plan, files, metadata };
  }

  public static async runFromSlug(
    slug: string,
    options: AgentCodegenOptions & { scenario?: string; sourceFile?: string } = {}
  ): Promise<PipelineResult> {
    const input = DeterministicCodegenPipeline.fromSlug(slug, options.scenario, options.sourceFile);
    if (!input) {
      throw new Error(`No execution history found for slug "${slug}"`);
    }
    return AgentCodegenPipeline.run(input, options);
  }
}

export type { CodegenArchitecture, GeneratedFile };
