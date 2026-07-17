import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { BrowserManager } from './BrowserManager';
import { ConfigManager } from './ConfigManager';
import { LLMClient } from './LLMClient';
import { PlannerAgent, PlannedStep } from '../agents/PlannerAgent';
import { ExecutionAgent, ExecutedAction } from '../agents/ExecutionAgent';
import { ValidationAgent } from '../agents/ValidationAgent';
import { HealingAgent } from '../agents/HealingAgent';
import { SymbolParser } from './SymbolParser';
import { CodegenContext } from './CodegenContext';
import { RepoKnowledgeGraph } from './knowledge/RepoKnowledgeGraph';
import { CodegenWriter } from './CodegenWriter';
import { runPostExecutionCodegen, PostExecutionCodegenResult } from './codegen/PostExecutionCodegen';
import { RawExecutionStep } from './codegen/ExecutionTrace';
import { generateExecutionReports } from './ExecutionReportService';
import { FlakeAnalyzer } from './flake/FlakeAnalyzer';
import { collectTestCaseReport } from './execution_report/collector';
import { BrowserProviderRegistry } from './browserProviders/BrowserProviderRegistry';
import { Logger } from '../utils/Logger';
import { UsageTracker } from '../utils/UsageTracker';
import { persistJobUsage } from '../utils/UsagePersistence';
import { PROJECT_ROOT } from './ProjectPaths';
import {
  ensureReportDirs,
  resolveExecutionHistoryPath,
  resolveLlmUsagePath,
  resolveSummaryPath,
  summaryPath,
} from './ReportPaths';
import { findCliInstallRoot } from '../cli/ProjectContext';
import { KnowledgeOnlyReplay } from './replay/KnowledgeOnlyReplay';
import { decideHistoryReuse, isSuccessfulActHistory } from './codegen/HistoryReuse';
import { ActHistoryCodegenAdapter } from './codegen/ActHistoryCodegenAdapter';
import { isReplayHealEnabled } from './replay/ReplayHealPolicy';
import { ActHistoryReplayService } from './replay/ActHistoryReplayService';

/** Model id used for USD estimates when LiteLLM cannot price Azure deployment names. */
function resolvePricingModelName(): string {
  if (process.env.WEBPILOT_LLM_MODEL) return process.env.WEBPILOT_LLM_MODEL;
  try {
    const llmPath = path.join(PROJECT_ROOT, 'resources', 'config', 'llm.json');
    if (fs.existsSync(llmPath)) {
      const llm = JSON.parse(fs.readFileSync(llmPath, 'utf8')) as Record<string, Record<string, string>>;
      const provider = ConfigManager.getInstance().get('framework.activeProvider', 'azure');
      const block = llm[provider] || {};
      const named = block.pricingModel || block.model || block.deploymentId;
      if (named) return named;
    }
  } catch {
    /* ignore */
  }
  return process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1';
}

export interface EngineRunResult {
  success: boolean;
  stepsExecuted: number;
}

function safeUnlinkCodegenTemp(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

export interface EngineOptions {
  testFilePath: string;
  env: string;
  headed?: boolean;
  interactive?: boolean;
  architecture?: 'flat' | 'pom' | 'bdd' | 'pom-bdd';
  fallbackReason?: string;
  forceBrowserUse?: boolean;
}

export class Engine {
  private testFilePath: string;
  private envName: string;
  private headed: boolean;
  private interactive: boolean;
  private architecture: 'flat' | 'pom' | 'bdd' | 'pom-bdd';
  private fallbackReason?: string;
  private forceBrowserUse: boolean;

  private browserManager!: BrowserManager;
  private llmClient!: LLMClient;
  private planner!: PlannerAgent;
  private executor!: ExecutionAgent;
  private validator!: ValidationAgent;
  private healer!: HealingAgent;

  constructor(options: EngineOptions) {
    this.testFilePath = options.testFilePath;
    this.envName = options.env;
    this.headed = options.headed ?? false;
    this.interactive = options.interactive ?? false;
    this.architecture = options.architecture ?? 'pom';
    this.fallbackReason = options.fallbackReason;
    this.forceBrowserUse = options.forceBrowserUse ?? false;
  }

  private async promptUser(message: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    return new Promise((resolve) => {
      rl.question(message, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  private loadConfigJSON(filePath: string): any {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  /**
   * Substitutes environment variables inside configuration targets (e.g. ${QA_USERNAME})
   */
  private interpolateSecrets(config: any): any {
    const str = JSON.stringify(config);
    const interpolated = str.replace(/\${(\w+)}/g, (_, name) => {
      return process.env[name] || `\${${name}}`;
    });
    return JSON.parse(interpolated);
  }

  private async mergeCodegenIntoReport(
    testSlug: string,
    codegenResult: PostExecutionCodegenResult
  ): Promise<void> {
    const reportPath = resolveSummaryPath(testSlug);
    let report: Record<string, unknown> = {};
    if (fs.existsSync(reportPath)) {
      report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    }
    report.summary = codegenResult.summary;
    if (codegenResult.reportCodegen) {
      report.codegen = codegenResult.reportCodegen;
    }
    fs.mkdirSync(path.dirname(summaryPath(testSlug)), { recursive: true });
    fs.writeFileSync(summaryPath(testSlug), JSON.stringify(report, null, 2), 'utf8');
  }

  private finalizeJobUsage(testSlug: string): void {
    const snapshot = UsageTracker.getSnapshot();
    persistJobUsage(testSlug, snapshot);
    const phaseBits = Object.entries(snapshot.phases)
      .filter(([, phase]) => phase.promptTokens + phase.completionTokens > 0)
      .map(([name, phase]) => {
        const tokens = phase.promptTokens + phase.completionTokens;
        return `${name} ${tokens.toLocaleString()}`;
      });
    const phaseNote = phaseBits.length ? ` (${phaseBits.join(' · ')})` : '';
    Logger.detail(
      `Final LLM usage: ${snapshot.totalTokens.toLocaleString()} tokens across ${snapshot.llmCalls} call(s), ~$${snapshot.estimatedCostUsd.toFixed(4)}${phaseNote}`
    );
  }

  /**
   * Main execution trigger
   */
  public async execute(): Promise<EngineRunResult> {
    UsageTracker.reset();
    Logger.info('Initializing execution session');

    const slug = path.basename(this.testFilePath, path.extname(this.testFilePath));
    const knowledgeOnly = process.env.WEBPILOT_KNOWLEDGE_ONLY === '1';
    const legacyJsKnowledge = process.env.WEBPILOT_LEGACY_KNOWLEDGE_REPLAY === '1';

    // Phase 4: knowledge-only uses Playwright (generated spec or ActHistory) — not JS execute_capability.
    if (knowledgeOnly && !legacyJsKnowledge) {
      Logger.info('Knowledge-only mode — Playwright replay (no browser-use / no LLM discovery)');
      const planned = KnowledgeOnlyReplay.plan(slug);
      Logger.detail(planned.reason);
      if (planned.strategy === 'unavailable') {
        Logger.error(planned.reason);
        Logger.detail(
          'Opt-in legacy JS site-knowledge: WEBPILOT_LEGACY_KNOWLEDGE_REPLAY=1 (deprecated).'
        );
        return { success: false, stepsExecuted: 0 };
      }
      const replay = await KnowledgeOnlyReplay.run(slug, {
        headed: this.headed,
        heal: isReplayHealEnabled(),
      });
      if (!replay.success) {
        Logger.error(replay.detail);
        return { success: false, stepsExecuted: replay.result?.stepsExecuted ?? 0 };
      }
      Logger.success(replay.detail);
      return {
        success: true,
        stepsExecuted: replay.result?.stepsExecuted ?? (planned.strategy === 'spec' ? 1 : 0),
      };
    }
    if (knowledgeOnly && legacyJsKnowledge) {
      Logger.warn(
        'WEBPILOT_LEGACY_KNOWLEDGE_REPLAY=1 — using deprecated JS site-knowledge execute_capability path.'
      );
    }
    
    // Load config profiles
    const configManager = ConfigManager.getInstance();
    const browserProvider = BrowserProviderRegistry.resolve();
    const providerOverride = Boolean(process.env.WEBPILOT_BROWSER_PROVIDER);
    const providerUsesBrowserUse = browserProvider.name !== 'local-playwright';
    const useBrowserUse = providerOverride
      ? providerUsesBrowserUse
      : configManager.get('framework.useBrowserUse', false);

    if (this.forceBrowserUse || useBrowserUse) {
      // Reuse prior ActHistory on --codegen re-runs to avoid rediscovery token burn.
      const historyDecision = decideHistoryReuse(this.testFilePath, slug);
      if (historyDecision.reuse && historyDecision.historyPath) {
        let historyDoc: Record<string, unknown> = {};
        try {
          historyDoc = JSON.parse(fs.readFileSync(historyDecision.historyPath, 'utf8')) as Record<
            string,
            unknown
          >;
        } catch {
          historyDoc = {};
        }

        // Defense in depth: never codegen/replay from a failed discovery artifact.
        if (!isSuccessfulActHistory(historyDoc)) {
          Logger.warn(
            'Prior ActHistory is not marked successful — forcing rediscovery instead of reuse'
          );
        } else {
          // Reuse skips expensive browser-use *discovery* (LLM agent), NOT the browser.
          // ActHistory must always be validated by replaying steps in a real browser —
          // otherwise "PASSED" is a false positive (history on disk ≠ scenario still works).
          Logger.info(
            `Skipping browser-use rediscovery — ${historyDecision.reason}. ` +
              `Validating ActHistory in a real browser before ${
                process.env.WEBPILOT_CODEGEN === '1' ? 'codegen' : 'pass'
              }…`
          );
          try {
            const pagesDir = path.join(process.cwd(), 'packages', 'test-framework', 'pages');
            const graph = SymbolParser.generateGraph(pagesDir);
            SymbolParser.saveGraph(
              graph,
              path.join(process.cwd(), 'packages', 'test-framework', 'symbol_graph.json')
            );
            await RepoKnowledgeGraph.refreshAsync();
          } catch (graphErr: any) {
            Logger.warn(`Symbol graph pre-generation skipped: ${graphErr.message}`);
          }

          const replay = await ActHistoryReplayService.replay(slug, {
            headed: this.headed,
            heal: isReplayHealEnabled(),
          });
          if (!replay.success) {
            Logger.error(
              replay.failure ||
                'ActHistory browser replay failed — not treating as pass; use --force-discovery to rediscover'
            );
            return { success: false, stepsExecuted: replay.stepsExecuted || 0 };
          }
          Logger.success(
            `ActHistory browser replay passed (${replay.stepsExecuted} steps` +
              (replay.healedCount ? `, ${replay.healedCount} healed` : '') +
              ')'
          );

          if (process.env.WEBPILOT_CODEGEN === '1') {
            UsageTracker.setPhase('codegen');
            // History-reuse path never went through initializeAgents — create LLM client here
            // for any explicit llm-mode codegen (deterministic path does not need repair fallback).
            if (!this.llmClient) {
              this.llmClient = new LLMClient();
            }
            const adapted = ActHistoryCodegenAdapter.loadFromSlug(slug);
            const codegenResult = await runPostExecutionCodegen({
              testName: slug,
              testFilePath: this.testFilePath,
              executionHistory: (adapted?.steps || []) as RawExecutionStep[],
              llmClient: this.llmClient,
              architecture: this.architecture,
              fallbackReason: this.fallbackReason,
              historyDocument: historyDoc,
              // Engine already validated ActHistory in the browser — don't replay twice.
              skipActHistoryHeal: true,
            });
            if (!codegenResult.success) {
              Logger.error(codegenResult.summary);
              return { success: false, stepsExecuted: adapted?.steps.length || replay.stepsExecuted || 0 };
            }
            Logger.success(codegenResult.summary);
            await this.mergeCodegenIntoReport(slug, codegenResult);
            this.finalizeJobUsage(slug);
            return { success: true, stepsExecuted: adapted?.steps.length || replay.stepsExecuted || 0 };
          }

          this.finalizeJobUsage(slug);
          return { success: true, stepsExecuted: replay.stepsExecuted || 0 };
        }
      }

      Logger.info(`Delegating to browser-use runner (${browserProvider.name})`);
      
      // 1. Generate/refresh the symbol graph so Python gets the latest repo knowledge
      try {
        const pagesDir = path.join(process.cwd(), 'packages', 'test-framework', 'pages');
        const graph = SymbolParser.generateGraph(pagesDir);
        SymbolParser.saveGraph(graph, path.join(process.cwd(), 'packages', 'test-framework', 'symbol_graph.json'));
        await RepoKnowledgeGraph.refreshAsync();
      } catch (graphErr: any) {
        Logger.warn(`Symbol graph pre-generation skipped: ${graphErr.message}`);
      }

      const { execFileSync } = require('child_process');
      const { ensureBrowserUsePython, splitPythonCommand } = require('../integrations/browser_use/PythonRuntime');
      let pythonPath: string;
      try {
        pythonPath = ensureBrowserUsePython();
      } catch (pyErr: any) {
        Logger.error(pyErr.message);
        return { success: false, stepsExecuted: 0 };
      }
      try {
        const installRoot = findCliInstallRoot();
        const reportCli = path.join(
          installRoot,
          'dist',
          'src',
          'core',
          'execution_report',
          'run-cli.js'
        );
        // Use execFileSync so Windows paths with spaces (Program Files) are not shell-split.
        const { exe, prefixArgs } = splitPythonCommand(pythonPath);
        execFileSync(
          exe,
          [
            ...prefixArgs,
            '-m',
            'integrations.browser_use',
            this.testFilePath,
            this.envName,
          ],
          {
            stdio: 'inherit',
            cwd: PROJECT_ROOT,
            env: {
              ...process.env,
              WEBPILOT_PROJECT_ROOT: PROJECT_ROOT,
              WEBPILOT_INSTALL_ROOT: installRoot,
              WEBPILOT_NODE: process.execPath,
              WEBPILOT_REPORT_CLI: reportCli,
              WEBPILOT_LLM_MODEL: resolvePricingModelName(),
              // Force-disable upstream browser-use PostHog telemetry / cloud sync.
              ANONYMIZED_TELEMETRY: 'false',
              BROWSER_USE_VERSION_CHECK: 'false',
              BROWSER_USE_CLOUD_SYNC: 'false',
              BROWSER_USE_CLOUD: 'false',
              PYTHONPATH: [
                path.join(installRoot, 'packages', 'browser-use'),
                path.join(installRoot, 'src'),
              ].join(path.delimiter),
            },
          }
        );

        const testName = path.basename(this.testFilePath, path.extname(this.testFilePath));
        const usagePath = resolveLlmUsagePath(testName);
        if (UsageTracker.loadExecutionFromFile(usagePath)) {
          const u = UsageTracker.getSnapshot();
          const execution = u.phases.execution;
          const executionTotal =
            (execution?.promptTokens ?? 0) + (execution?.completionTokens ?? 0);
          Logger.detail(
            `Loaded execution LLM usage: ${executionTotal.toLocaleString()} tokens, ~$${(execution?.estimatedCostUsd ?? u.estimatedCostUsd).toFixed(4)}`
          );
        }

        // 2. Post-process codegen output (deterministic or LLM-generated files)
        const tempCodegenPath = path.join(process.cwd(), 'packages', 'test-framework', 'temp_codegen.json');
        const baseName = path.basename(this.testFilePath, path.extname(this.testFilePath));
        if (fs.existsSync(tempCodegenPath)) {
          Logger.info('Post-processing generated POMs and specs');
          UsageTracker.setPhase('codegen');
          const codegenData = JSON.parse(fs.readFileSync(tempCodegenPath, 'utf8'));

          if (codegenData?.deterministic) {
            this.llmClient = new LLMClient();
            const historyFile =
              codegenData.executionHistoryPath || resolveExecutionHistoryPath(baseName);
            let steps: RawExecutionStep[] = [];
            let historyDocument: Record<string, unknown> | undefined;
            if (fs.existsSync(historyFile)) {
              const raw = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
              historyDocument = raw;
              steps = (raw.actHistory || raw.executionHistory || raw.steps || []) as RawExecutionStep[];
            }
            if (historyDocument && !isSuccessfulActHistory(historyDocument)) {
              Logger.warn(
                'Skipping codegen — only successful executions generate code'
              );
              safeUnlinkCodegenTemp(tempCodegenPath);
              this.finalizeJobUsage(baseName);
              return { success: false, stepsExecuted: steps.length };
            }
            const codegenResult = await runPostExecutionCodegen({
              testName: baseName,
              testFilePath: this.testFilePath,
              executionHistory: steps,
              llmClient: this.llmClient,
              architecture: this.architecture,
              symbolGraphContext: CodegenContext.buildSymbolGraphContext(),
              historyDocument,
            });
            if (!codegenResult.success) {
              Logger.error(codegenResult.summary);
              safeUnlinkCodegenTemp(tempCodegenPath);
              this.finalizeJobUsage(baseName);
              return { success: false, stepsExecuted: 0 };
            }
            Logger.success(codegenResult.summary);
            await this.mergeCodegenIntoReport(baseName, codegenResult);
          } else if (codegenData?.files?.length) {
            this.llmClient = new LLMClient();
            const execCtx = codegenData.executionContext as { urlSequence?: string[] } | undefined;
            const { ok } = await CodegenWriter.writeAndValidate(codegenData.files, this.llmClient, {
              testSlug: baseName,
              urls: execCtx?.urlSequence,
            });
            if (!ok) {
              Logger.error('Generated code failed validation');
              safeUnlinkCodegenTemp(tempCodegenPath);
              this.finalizeJobUsage(baseName);
              return { success: false, stepsExecuted: 0 };
            }
          }

          if (codegenData?.artifacts) {
            const reportPath = resolveSummaryPath(baseName);
            let report: Record<string, unknown> = {};
            if (fs.existsSync(reportPath)) {
              report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
            }
            report.artifacts = codegenData.artifacts;
            if (codegenData.executionHistoryPath) {
              report.executionHistoryPath = codegenData.executionHistoryPath;
            }
            fs.mkdirSync(path.dirname(summaryPath(baseName)), { recursive: true });
            fs.writeFileSync(summaryPath(baseName), JSON.stringify(report, null, 2), 'utf8');
            Logger.info(`Artifacts: ${JSON.stringify(codegenData.artifacts)}`);
          }

          safeUnlinkCodegenTemp(tempCodegenPath);
        }

        const historyPath = resolveExecutionHistoryPath(baseName);
        const stepsExecuted = fs.existsSync(historyPath)
          ? (() => {
              const hist = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
              return (hist.actHistory || hist.executionHistory)?.length ?? 0;
            })()
          : 0;

        this.finalizeJobUsage(baseName);
        return { success: true, stepsExecuted };
      } catch (err: any) {
        Logger.error(`browser-use execution failed: ${err.message}`);
        const failedSlug = path.basename(this.testFilePath, path.extname(this.testFilePath));
        // Python still saves usage in finally before exit — pick it up for Job summary.
        const failedUsagePath = resolveLlmUsagePath(failedSlug);
        if (UsageTracker.getSnapshot().totalTokens === 0) {
          UsageTracker.loadExecutionFromFile(failedUsagePath);
        }
        this.finalizeJobUsage(failedSlug);
        return { success: false, stepsExecuted: 0 };
      }
    }
    
    const envPath = path.join(process.cwd(), 'resources', 'config', 'environments', `${this.envName}.json`);
    let envConfig = this.loadConfigJSON(envPath);
    envConfig = this.interpolateSecrets(envConfig);

    Logger.info(`Environment "${this.envName}" → ${envConfig.baseUrl}`);

    // Instantiate LLM client and agents
    this.llmClient = new LLMClient();

    this.planner = new PlannerAgent(this.llmClient);
    this.executor = new ExecutionAgent(this.llmClient);
    this.validator = new ValidationAgent(this.llmClient);
    this.healer = new HealingAgent(this.llmClient, configManager.get('framework.healingCachePath', './healing-cache/cache.json'));

    // Initialize browser setup
    this.browserManager = new BrowserManager({
      browser: browserProvider.config.browserName || configManager.get('browser.target'),
      headless: this.headed ? false : browserProvider.config.headless,
      viewport: browserProvider.config.viewport || configManager.get('browser.viewport'),
      screenshots: configManager.get('browser.screenshots'),
      video: configManager.get('browser.video'),
      trace: configManager.get('browser.trace')
    });

    // Read test script
    if (!fs.existsSync(this.testFilePath)) {
      Logger.error(`Test script not found: ${this.testFilePath}`);
      return { success: false, stepsExecuted: 0 };
    }
    const testContent = fs.readFileSync(this.testFilePath, 'utf8');

    Logger.info('Planning natural language steps');
    const plan = await this.planner.plan(testContent);
    Logger.success(`Plan ready — ${plan.length} step${plan.length === 1 ? '' : 's'}`);
    plan.forEach((step) =>
      Logger.detail(`${step.index}. [${step.actionType}] ${step.originalText}`)
    );

    Logger.info(`Launching browser (${this.headed ? 'headed' : 'headless'})`);
    const page = await this.browserManager.launch();
    
    // Automatically open Base URL
    if (envConfig.baseUrl) {
      Logger.info(`Navigate to ${envConfig.baseUrl}`);
      await page.goto(envConfig.baseUrl);
    }

    const executionHistory: { action: string; selector?: string; value?: string; url?: string; description: string }[] = [];
    let success = true;

    // Loop through step sequences
    for (const step of plan) {
      Logger.step(step.index, plan.length, step.originalText);
      let stepDone = false;
      let actionHistoryList: string[] = [];
      let retries = 0;

      while (!stepDone) {
        // Retrieve visual and element details of current DOM state
        const state = await this.browserManager.getPageState();
        
        if (step.actionType === 'assert') {
          // Perform assertions
          const visibleText = await page.evaluate(() => document.body.innerText || '');
          Logger.info('Validating assertion');
          const validation = await this.validator.validate(step, state, visibleText);
          
          if (validation.passed) {
            Logger.success(validation.reasoning);
            executionHistory.push({
              action: 'assert',
              description: `Verified: ${step.originalText} (${validation.reasoning})`
            });
            stepDone = true;
          } else {
            Logger.warn(`Assertion not met: ${validation.reasoning}`);
            if (retries++ > 2) {
              Logger.error('Step validation timed out');
              success = false;
              stepDone = true;
            } else {
              Logger.detail('Waiting for page state…');
              await page.waitForTimeout(2000);
            }
          }
          continue;
        }

        // Logical execution step
        const decision = await this.executor.decideAction(step, state, actionHistoryList);
        Logger.ai(`${decision.action.toUpperCase()} — ${decision.reasoning}`);

        if (decision.action === 'done') {
          Logger.success(`Step ${step.index} complete`);
          stepDone = true;
          break;
        }

        if (decision.action === 'fail') {
          Logger.error(`Executor blocked: ${decision.reasoning}`);
          success = false;
          stepDone = true;
          break;
        }

        if (decision.action === 'wait') {
          Logger.detail(`Wait: ${decision.reasoning}`);
          await page.waitForTimeout(3000);
          continue;
        }

        // Support Interactive mode (Human-in-the-Loop)
        if (this.interactive) {
          Logger.warn('Human approval required');
          Logger.detail(`Proposed: ${decision.action.toUpperCase()} on "${decision.targetSelector || 'none'}"`);
          const ans = await this.promptUser(`Approve? (y/n) | Or type override instructions: `);
          
          if (ans.toLowerCase() === 'n') {
            Logger.warn('Action rejected by operator');
            continue;
          } else if (ans.trim() !== '' && ans.toLowerCase() !== 'y') {
            Logger.ai(`Override: "${ans}"`);
            step.description += ` (Human Override: ${ans})`;
            continue;
          }
        }

        // Apply visual action with defensive self-healing
        try {
          if (decision.action === 'navigate' && decision.url) {
            await page.goto(decision.url);
            executionHistory.push({ action: 'navigate', url: decision.url, description: decision.reasoning });
          } else if (decision.action === 'click' && decision.targetSelector) {
            await page.click(decision.targetSelector, { timeout: 5000 });
            executionHistory.push({ action: 'click', selector: decision.targetSelector, description: decision.reasoning });
          } else if (decision.action === 'input' && decision.targetSelector && decision.value) {
            await page.fill(decision.targetSelector, decision.value, { timeout: 5000 });
            executionHistory.push({ action: 'input', selector: decision.targetSelector, value: decision.value, description: decision.reasoning });
          }
          
          actionHistoryList.push(`Success: [${decision.action.toUpperCase()}] on "${decision.targetSelector || 'none'}"`);
        } catch (err: any) {
          Logger.warn(`Locator failed (${decision.targetSelector}), self-healing…`);
          
          if (decision.targetSelector) {
            const healResult = await this.healer.heal(decision.targetSelector, state, decision.action);
            if (healResult.confidence >= 0.6) {
              Logger.success(`Healed → "${healResult.healedSelector}" (${Math.round(healResult.confidence * 100)}% confidence)`);
              
              // Retry action on healed locator
              try {
                if (decision.action === 'click') {
                  await page.click(healResult.healedSelector);
                  executionHistory.push({ action: 'click', selector: healResult.healedSelector, description: `Healed: ${decision.reasoning}` });
                } else if (decision.action === 'input' && decision.value) {
                  await page.fill(healResult.healedSelector, decision.value);
                  executionHistory.push({ action: 'input', selector: healResult.healedSelector, value: decision.value, description: `Healed: ${decision.reasoning}` });
                }
                actionHistoryList.push(`Healed & Succeeded: [${decision.action.toUpperCase()}] on "${healResult.healedSelector}"`);
              } catch (retryErr) {
                Logger.error('Healing retry failed', retryErr instanceof Error ? retryErr : undefined);
                success = false;
                stepDone = true;
              }
            } else {
              Logger.error(`Healer confidence too low (${healResult.confidence})`);
              success = false;
              stepDone = true;
            }
          } else {
            success = false;
            stepDone = true;
          }
        }
      }

      if (!success) {
        Logger.error('Aborting suite due to step failure');
        break;
      }
    }

    // Clean up browser sessions and save traces
    const testName = path.basename(this.testFilePath, path.extname(this.testFilePath));
    await this.browserManager.close(testName, success);

    if (success) {
      Logger.success('Test suite completed — generating Playwright artifacts');
      
      const pagesDir = path.join(process.cwd(), 'packages', 'test-framework', 'pages');
      try {
        const graph = SymbolParser.generateGraph(pagesDir);
        SymbolParser.saveGraph(graph, path.join(process.cwd(), 'packages', 'test-framework', 'symbol_graph.json'));
        await RepoKnowledgeGraph.refreshAsync();
      } catch (graphErr: any) {
        Logger.warn(`Symbol graph refresh skipped: ${graphErr.message}`);
      }
      const symbolGraphContext = CodegenContext.buildSymbolGraphContext(pagesDir);

      let codegenSummary = 'Codegen skipped';
      let reportCodegen: Record<string, unknown> | undefined;
      try {
        UsageTracker.setPhase('codegen');
        const codegenResult = await runPostExecutionCodegen({
          testName,
          testFilePath: this.testFilePath,
          executionHistory: executionHistory as RawExecutionStep[],
          llmClient: this.llmClient!,
          architecture: this.architecture,
          symbolGraphContext,
          fallbackReason: this.fallbackReason,
        });
        codegenSummary = codegenResult.summary;
        if (!codegenResult.success) {
          success = false;
          Logger.error('Codegen validation failed — unresolved TypeScript errors');
        } else {
          Logger.success(codegenSummary);
        }
        if (codegenResult.reportCodegen) {
          reportCodegen = { ...codegenResult.reportCodegen };
        }
      } catch (pipelineErr: unknown) {
        const msg = pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr);
        Logger.warn(`Codegen failed: ${msg}`);
        success = false;
        codegenSummary = `Codegen failed: ${msg}`;
      }
      
      const usage = UsageTracker.getSnapshot();
      const reportSummary: Record<string, unknown> = {
        test: testName,
        status: success ? 'PASSED' : 'FAILED',
        timestamp: new Date().toISOString(),
        stepsExecuted: executionHistory.length,
        summary: codegenSummary,
        tokens: usage.totalTokens,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        estimatedCostUsd: usage.estimatedCostUsd,
        llmCalls: usage.llmCalls,
        phases: usage.phases,
        browser: {
          target: browserProvider.config.browserName,
          headless: this.headed ? false : browserProvider.config.headless,
          viewport: browserProvider.config.viewport || configManager.get('browser.viewport'),
          provider: browserProvider.sessionInfo(),
        },
      };
      
      if (this.fallbackReason) {
        reportSummary.failureContext = this.fallbackReason;
      }
      if (reportCodegen) {
        reportSummary.codegen = reportCodegen;
      }
      
      ensureReportDirs();
      fs.writeFileSync(
        summaryPath(testName),
        JSON.stringify(reportSummary, null, 2),
        'utf8'
      );
      persistJobUsage(testName, usage);

      if (!success) {
        const testReport = collectTestCaseReport(testName);
        if (testReport) {
          const flake = FlakeAnalyzer.analyzeTestCase(testReport, this.fallbackReason);
          if (flake) FlakeAnalyzer.persist(testName, flake);
        }
      }

      try {
        await generateExecutionReports({
          testSlugs: [testName],
          env: this.envName,
          testFilePath: this.testFilePath,
          suiteName: `WebPilot — ${testName}`,
        });
      } catch (reportErr: unknown) {
        const msg = reportErr instanceof Error ? reportErr.message : String(reportErr);
        Logger.warn(`HTML report generation skipped: ${msg}`);
      }
    } else {
      Logger.error('Test suite failed — diagnostics saved under /reports');
    }

    return { success, stepsExecuted: executionHistory.length };
  }
}
