import { ConfigManager } from '../ConfigManager';
import { CodegenAgent } from '../../agents/CodegenAgent';
import { GeneratedFile } from '../../agents/CodegenAgent';
import { CodegenWriter } from '../CodegenWriter';
import { CodegenContext } from '../CodegenContext';
import { LLMClient } from '../LLMClient';
import { Logger } from '../../utils/Logger';
import { ActHistoryCodegenAdapter } from './ActHistoryCodegenAdapter';
import {
  evaluateCompactCoverageGate,
  evaluateCompactVerifiedGate,
  formatCompactCoverageLog,
  getCompactWorkflow,
} from './CompactWorkflow';
import { DeterministicCodegenPipeline, PipelineInput } from './DeterministicCodegenPipeline';
import { CodegenMetadata, CodegenProfilePlan } from './GenerationPlan';
import { ReportCodegenInfo } from '../execution_report/types';
import { RawExecutionStep } from './ExecutionTrace';
import { tryReuseExistingGeneratedSpec } from './ExistingCodegenReuse';
import { isSuccessfulActHistory } from './HistoryReuse';
import { isReplayHealEnabled } from '../replay/ReplayHealPolicy';
import { ActHistoryReplayService } from '../replay/ActHistoryReplayService';
import { resolveExecutionHistoryPath } from '../ReportPaths';
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

/** Same keys written by `webpilot init` (`project.language` / tool / pattern). */
export function readProjectCodegenProfile(): CodegenProfilePlan {
  const config = ConfigManager.getInstance();
  const generatedCodePath = String(config.get('framework.generatedCodePath', '') || '')
    .replace(/\\/g, '/')
    .replace(/\/$/, '');
  const configuredLanguage = config.get('project.language') as string | undefined;
  let language = configuredLanguage;
  // Init sets generatedCodePath to ./tests/generated for Python. If language was
  // omitted/overwritten, infer python so we do not silently emit TypeScript specs.
  if (!language && /(?:^|\/)tests\/generated$/.test(generatedCodePath)) {
    language = 'python';
  }
  language = language || 'typescript';
  const automationTool = config.get('project.automationTool', 'playwright');
  const frameworkPattern = config.get('project.frameworkPattern', 'pom');
  const testFramework =
    config.get('project.testFramework') ||
    (language === 'python' ? 'pytest' : 'playwright-test');
  return {
    language,
    automationTool,
    frameworkPattern,
    testFramework,
  };
}

function hasExplicitProjectLanguage(): boolean {
  const language = ConfigManager.getInstance().get('project.language');
  return typeof language === 'string' && language.trim().length > 0;
}

/** Fail closed when Python codegen did not produce a runnable pytest module. */
export function assertPythonCodegenOutputs(files: GeneratedFile[]): void {
  const normalized = files.map((file) => ({
    ...file,
    path: file.path.replace(/\\/g, '/'),
  }));
  const testFiles = normalized.filter((file) => /\/test_[^/]+\.py$/.test(file.path));
  if (!testFiles.length) {
    throw new Error(
      'Python codegen produced no tests/generated/test_*.py files. ' +
        'Check project.language is "python" in resources/config/webpilot.yaml (webpilot init --language python).'
    );
  }
  for (const file of testFiles) {
    const fullPath = path.join(process.cwd(), file.path);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Python codegen did not write ${file.path} to disk`);
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    if (!/def\s+test_/.test(content)) {
      throw new Error(`Python test file ${file.path} has no def test_* function`);
    }
    // Broken short imports (from pages.X) look like "no tests" under pytest collection.
    if (/^from pages\./m.test(content)) {
      throw new Error(
        `Python test ${file.path} uses broken "from pages.*" imports; expected tests.generated.pages.*`
      );
    }
  }
}

/** LLM CodegenAgent / RepoEdit repair only supports TypeScript Playwright today. */
export function supportsTypeScriptAgentCodegen(profile: CodegenProfilePlan = readProjectCodegenProfile()): boolean {
  return profile.language === 'typescript' && profile.automationTool === 'playwright';
}

export function resolveCodegenMode(): CodegenMode {
  const envMode = process.env.WEBPILOT_CODEGEN_MODE?.trim().toLowerCase();
  if (envMode === 'deterministic' || envMode === 'llm' || envMode === 'auto') {
    // `auto` is treated as deterministic — no LLM repair/fallback (avoids false PASSED).
    return envMode === 'auto' ? 'deterministic' : envMode;
  }
  const configMode = ConfigManager.getInstance().get('framework.codegenMode', 'deterministic');
  if (configMode === 'llm') return 'llm';
  // auto and deterministic (and anything else) → deterministic only
  return 'deterministic';
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

function loadHistoryDocument(
  testName: string,
  provided?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (provided) return provided;
  const historyPath = resolveExecutionHistoryPath(testName);
  if (!fs.existsSync(historyPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(historyPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Codegen is only allowed after a successful discovery/execution.
 * Failed ActHistory must not produce POMs/specs (avoids false-positive "PASSED").
 */
function skipCodegenUnlessSuccessful(
  historyDocument: Record<string, unknown> | undefined
): PostExecutionCodegenResult | null {
  // No ActHistory document → caller already gated success (e.g. local Playwright path).
  if (!historyDocument) return null;
  if (isSuccessfulActHistory(historyDocument)) return null;
  Logger.warn(
    'Skipping codegen — only successful executions generate code (discovery/execution failed)'
  );
  return {
    success: false,
    summary:
      'Codegen skipped — execution was not successful. Fix the failing run (or use --force-discovery) before generating code.',
    files: [],
  };
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
  /**
   * When Engine already validated ActHistory via browser replay, skip the
   * duplicate heal-replay inside codegen (avoids opening the browser twice).
   */
  skipActHistoryHeal?: boolean;
}): Promise<PostExecutionCodegenResult> {
  const historyDocument = loadHistoryDocument(options.testName, options.historyDocument);
  const blocked = skipCodegenUnlessSuccessful(historyDocument);
  if (blocked) return blocked;

  const compact = getCompactWorkflow(historyDocument);
  if (compact) {
    const coverageLog = formatCompactCoverageLog(compact);
    if (coverageLog) Logger.detail(coverageLog);
    const coverageGate = evaluateCompactCoverageGate(compact, { codegen: true });
    if (!coverageGate.ok) {
      Logger.warn(coverageGate.message);
      return {
        success: false,
        summary:
          'Codegen blocked — compact workflow NL coverage incomplete. ' +
          'Re-run discovery (--force-discovery) or set WEBPILOT_COMPACT_COVERAGE_GATE=warn. ' +
          coverageGate.message,
        files: [],
      };
    }
    if (coverageGate.coverage?.unmapped?.length) {
      Logger.warn(coverageGate.message);
    }
    const verifiedGate = evaluateCompactVerifiedGate(compact);
    if (!verifiedGate.ok) {
      Logger.warn(verifiedGate.message);
      return {
        success: false,
        summary: `Codegen blocked — ${verifiedGate.message}`,
        files: [],
      };
    }
  }

  const mode = resolveCodegenMode();
  const projectProfile = readProjectCodegenProfile();
  const tsAgentOk = supportsTypeScriptAgentCodegen(projectProfile);
  const generatedCodePath = String(
    ConfigManager.getInstance().get('framework.generatedCodePath', '') || ''
  ).replace(/\\/g, '/');
  if (
    projectProfile.language === 'typescript' &&
    /(?:^|\/)tests\/generated\/?$/.test(generatedCodePath.replace(/\/$/, ''))
  ) {
    Logger.warn(
      `framework.generatedCodePath is "${generatedCodePath}" but project.language is typescript — ` +
        `codegen will write .spec.ts under packages/test-framework, not Python under tests/generated. ` +
        `Set project.language: python (or re-run: webpilot init --language python).`
    );
  }
  if (projectProfile.language === 'python' && !hasExplicitProjectLanguage()) {
    Logger.warn(
      'project.language was inferred as python from framework.generatedCodePath — ' +
        'add an explicit project.language: python block to webpilot.yaml'
    );
  }
  Logger.detail(
    `Codegen profile: ${projectProfile.language}/${projectProfile.automationTool}/${projectProfile.frameworkPattern}`
  );

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
  // Note: ActHistory heal replay proves the *history* path works; regenerating Playwright
  // code afterward is a separate concern (codegen quality), not proof that history is wrong.
  // Skipped when Engine already ran browser ActHistory replay (skipActHistoryHeal).
  let actHistoryHealPassed = Boolean(options.skipActHistoryHeal);
  let actHistoryHealSteps = 0;
  if (
    !options.skipActHistoryHeal &&
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
        actHistoryHealPassed = true;
        actHistoryHealSteps = healedReplay.stepsExecuted;
        Logger.success(
          `ActHistory heal replay passed (${healedReplay.stepsExecuted} steps` +
            (healedReplay.healedCount ? `, ${healedReplay.healedCount} healed` : '') +
            '). Regenerating Playwright code from ActHistory (history is OK — codegen is the weak link)…'
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
  if (historyDocument) {
    const adapted = ActHistoryCodegenAdapter.fromDocument(historyDocument, options.testName);
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

  const runDeterministic = async (): Promise<PostExecutionCodegenResult> => {
    const result = await DeterministicCodegenPipeline.run(pipelineInput, {
      validate: options.validate !== false,
      // Never repair/fallback during `webpilot run --codegen` — fail closed.
      agentRepair: false,
    });
    if (projectProfile.language === 'python') {
      assertPythonCodegenOutputs(result.files);
    }
    const reportCodegen = DeterministicCodegenPipeline.toReportCodegen(result.metadata, result.plan);
    const outputHint =
      projectProfile.language === 'python'
        ? result.files
            .map((file) => file.path.replace(/\\/g, '/'))
            .filter((p) => p.endsWith('.py'))
            .slice(0, 5)
            .join(', ')
        : result.metadata.specPath;
    Logger.success(
      `Codegen wrote ${result.files.length} ${projectProfile.language} file(s)` +
        (outputHint ? `: ${outputHint}` : '')
    );
    return {
      success: true,
      summary: buildSummary(result.metadata, result.files.length),
      files: result.files,
      metadata: result.metadata,
      reportCodegen,
    };
  };

  const runLlm = async (): Promise<PostExecutionCodegenResult> => {
    if (!tsAgentOk) {
      throw new Error(
        `LLM CodegenAgent only supports TypeScript Playwright. ` +
          `Current project profile is ${projectProfile.language}/${projectProfile.automationTool} ` +
          `(set by webpilot init → project.language). Use deterministic codegen for this stack.`
      );
    }
    const llm = options.llmClient ?? new LLMClient();
    const codegen = new CodegenAgent(llm);
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
    const { ok, paths } = await CodegenWriter.writeAndValidate(generated.files, llm, {
      testSlug: options.testName,
      urls: [...new Set(steps.map((step) => step.url).filter(Boolean) as string[])],
    });
    return {
      success: ok,
      summary: ok ? generated.summary : `${generated.summary} (codegen validation failed for ${paths.join(', ')})`,
      files: generated.files,
    };
  };

  const withHealContext = (result: PostExecutionCodegenResult): PostExecutionCodegenResult => {
    if (!actHistoryHealPassed || result.success) return result;
    return {
      ...result,
      summary:
        `ActHistory heal replay passed (${actHistoryHealSteps} steps) but Playwright codegen regenerate failed. ` +
        `History is correct — use: webpilot run <test>  (without --codegen) to replay history, ` +
        `or fix generated specs. Underlying: ${result.summary}`,
    };
  };

  if (mode === 'llm') {
    if (!tsAgentOk) {
      Logger.warn(
        `Codegen mode llm is TypeScript-only; using deterministic codegen for ` +
          `${projectProfile.language}/${projectProfile.automationTool} (honors webpilot init profile).`
      );
      try {
        return withHealContext(await runDeterministic());
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.error(`Deterministic codegen failed: ${message}`);
        return withHealContext({
          success: false,
          summary: `Deterministic codegen failed: ${message}`,
          files: [],
        });
      }
    }
    Logger.info('Codegen mode: llm (explicit CodegenAgent — no deterministic draft)');
    try {
      return withHealContext(await runLlm());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.error(`LLM codegen failed: ${message}`);
      return withHealContext({
        success: false,
        summary: `LLM codegen failed: ${message}`,
        files: [],
      });
    }
  }

  // deterministic (default): ActHistory → profile emit → validate. Fail closed — no agent fallback.
  try {
    Logger.info(
      `Codegen mode: deterministic (${projectProfile.language}/${projectProfile.automationTool}; no agent fallback)`
    );
    return withHealContext(await runDeterministic());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Logger.error(`Deterministic codegen failed: ${message}`);
    return withHealContext({
      success: false,
      summary: `Deterministic codegen failed: ${message}`,
      files: [],
    });
  }
}
