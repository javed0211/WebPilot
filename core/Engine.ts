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
import { CodegenAgent } from '../agents/CodegenAgent';
import { SymbolParser } from './SymbolParser';
import { CodegenContext } from './CodegenContext';
import { CodegenWriter } from './CodegenWriter';
import { generateExecutionReports } from './ExecutionReportService';
import { Logger } from '../utils/Logger';
import { UsageTracker } from '../utils/UsageTracker';

export interface EngineRunResult {
  success: boolean;
  stepsExecuted: number;
}

export interface EngineOptions {
  testFilePath: string;
  env: string;
  headed?: boolean;
  interactive?: boolean;
  architecture?: 'flat' | 'pom' | 'bdd' | 'pom-bdd';
  fallbackReason?: string;
}

export class Engine {
  private testFilePath: string;
  private envName: string;
  private headed: boolean;
  private interactive: boolean;
  private architecture: 'flat' | 'pom' | 'bdd' | 'pom-bdd';
  private fallbackReason?: string;

  private browserManager!: BrowserManager;
  private llmClient!: LLMClient;
  private planner!: PlannerAgent;
  private executor!: ExecutionAgent;
  private validator!: ValidationAgent;
  private healer!: HealingAgent;
  private codegen!: CodegenAgent;

  constructor(options: EngineOptions) {
    this.testFilePath = options.testFilePath;
    this.envName = options.env;
    this.headed = options.headed ?? false;
    this.interactive = options.interactive ?? false;
    this.architecture = options.architecture ?? 'pom';
    this.fallbackReason = options.fallbackReason;
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

  /**
   * Main execution trigger
   */
  public async execute(): Promise<EngineRunResult> {
    UsageTracker.reset();
    Logger.info('Initializing execution session');
    
    // Load config profiles
    const configManager = ConfigManager.getInstance();
    const useBrowserUse = configManager.get('framework.useBrowserUse', false);

    if (useBrowserUse) {
      Logger.info('Delegating to browser-use runner');
      
      // 1. Generate/refresh the symbol graph so Python gets the latest repo knowledge
      try {
        const pagesDir = path.join(process.cwd(), 'framework', 'pages');
        const graph = SymbolParser.generateGraph(pagesDir);
        SymbolParser.saveGraph(graph, path.join(process.cwd(), 'framework', 'symbol_graph.json'));
      } catch (graphErr: any) {
        Logger.warn(`Symbol graph pre-generation skipped: ${graphErr.message}`);
      }

      const { execSync } = require('child_process');
      const { ensureBrowserUsePython } = require('./pythonEnv');
      let pythonPath: string;
      try {
        pythonPath = ensureBrowserUsePython();
      } catch (pyErr: any) {
        Logger.error(pyErr.message);
        return { success: false, stepsExecuted: 0 };
      }
      const runnerPath = path.join(process.cwd(), 'core', 'browser_use_runner.py');

      try {
        execSync(`"${pythonPath}" "${runnerPath}" "${this.testFilePath}" "${this.envName}"`, {
          stdio: 'inherit',
          env: { ...process.env, PYTHONPATH: path.join(process.cwd(), 'core') },
        });

        const testName = path.basename(this.testFilePath, path.extname(this.testFilePath));
        const usagePath = path.join(process.cwd(), 'reports', `${testName}_llm_usage.json`);
        if (UsageTracker.loadFromFile(usagePath)) {
          const u = UsageTracker.getSnapshot();
          Logger.detail(
            `Loaded browser-use LLM usage: ${u.totalTokens.toLocaleString()} tokens, ~$${u.estimatedCostUsd.toFixed(4)}`
          );
        }

        // 2. Perform non-destructive AST merging on the generated files
        const tempCodegenPath = path.join(process.cwd(), 'framework', 'temp_codegen.json');
        if (fs.existsSync(tempCodegenPath)) {
          Logger.info('Post-processing generated POMs and specs');
          const codegenData = JSON.parse(fs.readFileSync(tempCodegenPath, 'utf8'));

          if (codegenData?.files?.length) {
            this.llmClient = new LLMClient();
            const baseName = path.basename(this.testFilePath, path.extname(this.testFilePath));
            const execCtx = codegenData.executionContext as { urlSequence?: string[] } | undefined;
            const { ok } = await CodegenWriter.writeAndValidate(codegenData.files, this.llmClient, {
              testSlug: baseName,
              urls: execCtx?.urlSequence,
            });
            if (!ok) {
              Logger.error('Generated code failed validation');
              fs.unlinkSync(tempCodegenPath);
              return { success: false, stepsExecuted: 0 };
            }
          }

          if (codegenData?.artifacts) {
            const baseName = path.basename(this.testFilePath, path.extname(this.testFilePath));
            const reportPath = path.join(process.cwd(), 'reports', `${baseName}_summary.json`);
            let report: Record<string, unknown> = {};
            if (fs.existsSync(reportPath)) {
              report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
            }
            report.artifacts = codegenData.artifacts;
            if (codegenData.executionHistoryPath) {
              report.executionHistoryPath = codegenData.executionHistoryPath;
            }
            fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
            Logger.info(`Artifacts: ${JSON.stringify(codegenData.artifacts)}`);
          }

          fs.unlinkSync(tempCodegenPath);
        }

        const historyPath = path.join(
          process.cwd(),
          'reports',
          `${path.basename(this.testFilePath, path.extname(this.testFilePath))}_execution_history.json`
        );
        const stepsExecuted = fs.existsSync(historyPath)
          ? (JSON.parse(fs.readFileSync(historyPath, 'utf8')).executionHistory?.length ?? 0)
          : 0;

        return { success: true, stepsExecuted };
      } catch (err: any) {
        Logger.error(`browser-use execution failed: ${err.message}`);
        return { success: false, stepsExecuted: 0 };
      }
    }
    
    const envPath = path.join(process.cwd(), 'config', 'environments', `${this.envName}.json`);
    let envConfig = this.loadConfigJSON(envPath);
    envConfig = this.interpolateSecrets(envConfig);

    Logger.info(`Environment "${this.envName}" → ${envConfig.baseUrl}`);

    // Instantiate LLM client and agents
    this.llmClient = new LLMClient();

    this.planner = new PlannerAgent(this.llmClient);
    this.executor = new ExecutionAgent(this.llmClient);
    this.validator = new ValidationAgent(this.llmClient);
    this.healer = new HealingAgent(this.llmClient, configManager.get('framework.healingCachePath', './healing-cache/cache.json'));
    this.codegen = new CodegenAgent(this.llmClient);

    // Initialize browser setup
    this.browserManager = new BrowserManager({
      browser: configManager.get('browser.target'),
      headless: this.headed ? false : configManager.get('browser.headless'),
      viewport: configManager.get('browser.viewport'),
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
      
      const pagesDir = path.join(process.cwd(), 'framework', 'pages');
      try {
        const graph = SymbolParser.generateGraph(pagesDir);
        SymbolParser.saveGraph(graph, path.join(process.cwd(), 'framework', 'symbol_graph.json'));
      } catch (graphErr: any) {
        Logger.warn(`Symbol graph refresh skipped: ${graphErr.message}`);
      }
      const symbolGraphContext = CodegenContext.buildSymbolGraphContext(pagesDir);

      const codegen = await this.codegen.generateCode(
        testName,
        executionHistory,
        this.architecture,
        symbolGraphContext,
        this.fallbackReason
      );
      Logger.success(`Codegen wrote ${codegen.files.length} file(s)`);

      const { ok } = await CodegenWriter.writeAndValidate(codegen.files, this.llmClient!);
      if (!ok) {
        success = false;
        Logger.error('Codegen validation failed — unresolved Python or pytest errors');
      }
      
      const usage = UsageTracker.getSnapshot();
      const reportSummary: any = {
        test: testName,
        status: success ? 'PASSED' : 'FAILED',
        timestamp: new Date().toISOString(),
        stepsExecuted: executionHistory.length,
        summary: success ? codegen.summary : `${codegen.summary} (codegen validation failed)`,
        tokens: usage.totalTokens,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        estimatedCostUsd: usage.estimatedCostUsd,
        llmCalls: usage.llmCalls,
        phases: usage.phases
      };
      
      if (this.fallbackReason) {
        reportSummary.failureContext = this.fallbackReason;
      }
      if (codegen.fixReport) {
        reportSummary.fixReport = codegen.fixReport;
      }
      
      fs.mkdirSync(path.join(process.cwd(), 'reports'), { recursive: true });
      fs.writeFileSync(
        path.join(process.cwd(), 'reports', `${testName}_summary.json`),
        JSON.stringify(reportSummary, null, 2),
        'utf8'
      );

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
