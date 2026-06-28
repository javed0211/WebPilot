import { ConfigManager } from '../ConfigManager';
import { CodegenAgent } from '../../agents/CodegenAgent';
import { GeneratedFile } from '../../agents/CodegenAgent';
import { CodegenWriter } from '../CodegenWriter';
import { CodegenContext } from '../CodegenContext';
import { LLMClient } from '../LLMClient';
import { Logger } from '../../utils/Logger';
import { DeterministicCodegenPipeline, PipelineInput } from './DeterministicCodegenPipeline';
import { CodegenMetadata } from './GenerationPlan';
import { ReportCodegenInfo } from '../execution_report/types';

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
  const configMode = ConfigManager.getInstance().get('framework.codegenMode', 'deterministic');
  if (configMode === 'deterministic' || configMode === 'llm' || configMode === 'auto') {
    return configMode;
  }
  return 'deterministic';
}

function buildSummary(metadata: CodegenMetadata, fileCount: number): string {
  return `Deterministic codegen wrote ${fileCount} file(s) for ${metadata.scenarioSlug}. Replay with: webpilot replay ${metadata.specPath}`;
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
}): Promise<PostExecutionCodegenResult> {
  const mode = resolveCodegenMode();
  const pipelineInput: PipelineInput = {
    scenario: options.testName,
    scenarioSlug: options.testName,
    sourceFile: options.testFilePath,
    steps: options.executionHistory,
    targetUrl: options.executionHistory.find((step) => step.url)?.url || undefined,
  };

  const runDeterministic = async (): Promise<PostExecutionCodegenResult> => {
    const result = await DeterministicCodegenPipeline.run(pipelineInput, {
      validate: options.validate !== false,
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
    const llmSteps = options.executionHistory.map((step) => ({
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
      options.symbolGraphContext ?? CodegenContext.buildSymbolGraphContext(),
      options.fallbackReason
    );
    const { ok, paths } = await CodegenWriter.writeAndValidate(generated.files, options.llmClient, {
      testSlug: options.testName,
      urls: [...new Set(options.executionHistory.map((step) => step.url).filter(Boolean) as string[])],
    });
    return {
      success: ok,
      summary: ok ? generated.summary : `${generated.summary} (codegen validation failed)`,
      files: generated.files,
    };
  };

  if (mode === 'llm') {
    Logger.info('Codegen mode: llm');
    return runLlm();
  }

  try {
    Logger.info(`Codegen mode: ${mode}`);
    const deterministic = await runDeterministic();
    return deterministic;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (mode === 'auto') {
      Logger.warn(`Deterministic codegen failed (${message}); falling back to LLM codegen.`);
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
