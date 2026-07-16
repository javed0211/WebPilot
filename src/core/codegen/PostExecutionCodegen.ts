import { ConfigManager } from '../ConfigManager';
import { CodegenAgent } from '../../agents/CodegenAgent';
import { GeneratedFile } from '../../agents/CodegenAgent';
import { CodegenWriter } from '../CodegenWriter';
import { CodegenContext } from '../CodegenContext';
import { LLMClient } from '../LLMClient';
import { Logger } from '../../utils/Logger';
import { ActHistoryCodegenAdapter } from './ActHistoryCodegenAdapter';
import { DeterministicCodegenPipeline, PipelineInput } from './DeterministicCodegenPipeline';
import { CodegenMetadata } from './GenerationPlan';
import { ReportCodegenInfo } from '../execution_report/types';
import { RawExecutionStep } from './ExecutionTrace';
import { tryReuseExistingGeneratedSpec } from './ExistingCodegenReuse';
import { isReplayHealEnabled } from '../replay/ReplayHealPolicy';
import { ActHistoryReplayService } from '../replay/ActHistoryReplayService';
import * as fs from 'fs';
import * as path from 'path';

export type CodegenMode = 'deterministic' | 'llm' | 'auto';

export interface PostExecutionCodegenResult {
  success: boolean;
  summary: string;
  files: GeneratedFile[];
  metadata?: CodegenMetadata;
  reportCodegen?: ReportCodegenInfo;
}

export function resolveCodegenMode(): CodegenMode {
  const envMode = process.env.WEBPILOT_CODEGEN_MODE?.trim().toLowerCase();
  if (envMode === 'deterministic' || envMode === 'llm' || envMode === 'auto') {
    return envMode;
  }
  // Default auto: ActHistory deterministic draft, CodegenAgent repairs with knowledge graph.
  const configMode = ConfigManager.getInstance().get('framework.codegenMode', 'auto');
  if (configMode === 'deterministic' || configMode === 'llm' || configMode === 'auto') {
    return configMode;
  }
  return 'auto';
}

function buildSummary(metadata: CodegenMetadata, fileCount: number): string {
  const replay =
    metadata.mode === 'deterministic' || !metadata.mode
      ? `webpilot replay ${metadata.specPath}`
      : `webpilot replay ${metadata.specPath}`;
  return `Codegen (${metadata.mode || 'deterministic'}) wrote ${fileCount} file(s) for ${metadata.scenarioSlug}. Replay with: ${replay}`;
}

function toPipelineSteps(steps: RawExecutionStep[]): PipelineInput['steps'] {
  return steps.map((step) => ({
    ...step,
    description: step.description || step.action,
  }));
}

export async function runPostExecutionCodegen(options: {
  testName: string;
  testFilePath: string;
  executionHistory: PipelineInput['steps'];
  llmClient: LLMClient;
  architecture: 'flat' | 'pom' | 'bdd' | 'pom-bdd';
  symbolGraphContext?: string;
  fallbackReason?: string;
  validate?: boolean;
  /** Optional raw execution context (ActHistory document fields). */
  historyDocument?: Record<string, unknown>;
}): Promise<PostExecutionCodegenResult> {
  const mode = resolveCodegenMode();
  const existing = tryReuseExistingGeneratedSpec(options.testName);
  if (existing.reuse && existing.specPath) {
    Logger.info(`Skipping codegen regenerate — ${existing.reason}`);
    const content = fs.readFileSync(path.join(process.cwd(), existing.specPath), 'utf8');
    return {
      success: true,
      summary: `Codegen reused existing passing spec ${existing.specPath} (0 LLM tokens). Replay with: webpilot replay ${existing.specPath}`,
      files: [{ path: existing.specPath, content }],
      reportCodegen: {
        mode: 'reuse',
        specPath: existing.specPath,
        pageObjectPaths: [],
        metadataPath: '',
        tracePath: '',
        planPath: '',
        replayCommand: `webpilot replay ${existing.specPath}`,
        generatedFiles: [existing.specPath],
        notes: [existing.reason],
      },
    };
  }
  if (!existing.reuse && existing.reason) {
    Logger.detail(`Codegen reuse skipped: ${existing.reason}`);
  }

  // Spec failed on re-run: auto-heal via ActHistory first (no --heal flag required).
  if (
    !existing.reuse &&
    existing.specPath &&
    /failed Playwright/i.test(existing.reason) &&
    isReplayHealEnabled()
  ) {
    Logger.info(
      'Existing generated spec failed — attempting ActHistory replay with automatic self-heal…'
    );
    try {
      const healedReplay = await ActHistoryReplayService.replay(options.testName, {
        heal: true,
      });
      if (healedReplay.success) {
        Logger.success(
          `ActHistory heal replay passed (${healedReplay.stepsExecuted} steps` +
            (healedReplay.healedCount ? `, ${healedReplay.healedCount} healed` : '') +
            '). Regenerating code with healing cache applied…'
        );
      } else {
        Logger.warn(
          `ActHistory heal replay still failed (${healedReplay.failure || 'unknown'}). Falling back to codegen regenerate.`
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`ActHistory heal attempt skipped: ${message}`);
    }
  }

  const graphContext =
    options.symbolGraphContext ?? CodegenContext.buildSymbolGraphContext();

  let steps = toPipelineSteps(options.executionHistory);
  let historySource = 'runtime-history';
  if (options.historyDocument) {
    const adapted = ActHistoryCodegenAdapter.fromDocument(
      options.historyDocument,
      options.testName
    );
    if (adapted.steps.length) {
      steps = adapted.steps;
      historySource = adapted.historySource || historySource;
    }
  } else {
    const fromDisk = ActHistoryCodegenAdapter.loadFromSlug(options.testName);
    if (fromDisk?.steps.length) {
      steps = fromDisk.steps;
      historySource = fromDisk.historySource || historySource;
    }
  }

  const pipelineInput: PipelineInput = {
    scenario: options.testName,
    scenarioSlug: options.testName,
    sourceFile: options.testFilePath,
    steps,
    targetUrl: steps.find((step) => step.url)?.url || undefined,
    historySource,
    symbolGraphContext: graphContext,
  };

  const runDeterministic = async (agentRepair: boolean): Promise<PostExecutionCodegenResult> => {
    const result = await DeterministicCodegenPipeline.run(pipelineInput, {
      validate: options.validate !== false,
      agentRepair,
    });
    const reportCodegen = DeterministicCodegenPipeline.toReportCodegen(result.metadata, result.plan);
    return {
      success: true,
      summary: buildSummary(result.metadata, result.files.length),
      files: result.files,
      metadata: result.metadata,
      reportCodegen,
    };
  };

  const runLlm = async (): Promise<PostExecutionCodegenResult> => {
    const codegen = new CodegenAgent(options.llmClient);
    const llmSteps = steps.map((step) => ({
      action: step.action,
      selector: step.selector ?? undefined,
      value: step.value ?? undefined,
      url: step.url ?? undefined,
      description: step.description,
    }));
    const generated = await codegen.generateCode(
      options.testName,
      llmSteps,
      options.architecture,
      graphContext,
      options.fallbackReason
    );
    const { ok, paths } = await CodegenWriter.writeAndValidate(generated.files, options.llmClient, {
      testSlug: options.testName,
      urls: [...new Set(steps.map((step) => step.url).filter(Boolean) as string[])],
    });
    return {
      success: ok,
      summary: ok ? generated.summary : `${generated.summary} (codegen validation failed for ${paths.join(', ')})`,
      files: generated.files,
    };
  };

  if (mode === 'llm') {
    Logger.info('Codegen mode: llm (ActHistory + knowledge graph)');
    return runLlm();
  }

  try {
    Logger.info(`Codegen mode: ${mode} (ActHistory → deterministic${mode === 'auto' ? ' → agent repair' : ''})`);
    // auto/deterministic: draft from ActHistory; auto enables CodegenAgent repair on validation failure
    return await runDeterministic(mode === 'auto');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (mode === 'auto') {
      Logger.warn(`Codegen pipeline failed (${message}); falling back to CodegenAgent.`);
      return runLlm();
    }
    Logger.error(`Deterministic codegen failed: ${message}`);
    return {
      success: false,
      summary: `Deterministic codegen failed: ${message}`,
      files: [],
    };
  }
}
