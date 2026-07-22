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
import * as fs from 'fs';
import * as path from 'path';

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

/**
 * Repo-aware codegen: knowledge graph tools + coding agent (default path when
 * the graph has reusable pages). Deterministic emit remains available via
 * `--deterministic`.
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
    const graph = await RepoKnowledgeGraph.refreshAsync(undefined, { enrich });
    const tools = new CodegenTools(undefined, graph);
    const detection = resolveCodegenArchitecture({
      override: options.architecture,
    });
    const architecture = detection.architecture;
    Logger.info(
      `[AgentCodegen] architecture=${architecture} (${detection.confidence}): ${detection.reasons.join('; ')}`
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
    const profile = readProjectCodegenProfile();
    // Align profile pattern with detection for metadata/plan consumers
    const planProfile = {
      ...profile,
      frameworkPattern: detection.frameworkPattern,
    };

    // Build a lightweight plan via deterministic path for metadata/spec paths,
    // but keep agent-written files as SoT.
    const { trace, plan } = DeterministicCodegenPipeline.buildTraceAndPlan({
      ...input,
    });
    plan.profile = {
      ...plan.profile,
      frameworkPattern: detection.frameworkPattern,
    };
    plan.notes.push(
      `Agent codegen: architecture=${architecture} confidence=${detection.confidence}`
    );
    plan.notes.push(...detection.reasons.map((r) => `Architecture: ${r}`));

    let metadata = DeterministicCodegenPipeline.persist(trace, plan, files);
    metadata = { ...metadata, mode: 'llm' as const };

    if (options.validate === false) {
      CodegenWriter.writeFiles(files);
      return { trace, plan, files, metadata };
    }

    if (planProfile.language !== 'typescript' || planProfile.automationTool !== 'playwright') {
      CodegenWriter.writeFiles(files);
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
      files = [...generated.files];
      if (!files.some((file) => file.path.endsWith('.spec.ts'))) {
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
