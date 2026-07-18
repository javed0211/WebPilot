import * as fs from 'fs';
import * as path from 'path';
import { request as playwrightRequest } from 'playwright';
import { ConfigManager } from './ConfigManager';
import { LLMClient } from './LLMClient';
import { Logger } from '../utils/Logger';
import { ApiTestParser } from './api/ApiTestParser';
import { ApiRunnerPlaywright } from './api/ApiRunnerPlaywright';
import { ApiCodegenService } from './api/ApiCodegenService';
import { CodegenWriter } from './CodegenWriter';
import { ApiContext, resolveApiAuthHeaders } from '../../packages/test-framework/core/ApiContext';
import { EngineRunResult } from './Engine';
import { apiReportPath, ensureReportDirs, summaryPath } from './ReportPaths';
import { generateExecutionReports } from './ExecutionReportService';
import { archiveCurrentRun } from './execution_report/history';
import { ApiAuthPlan } from './api/types';

export interface ApiEngineOptions {
  testFilePath: string;
  env: string;
  enableCodegen?: boolean;
}

export class ApiEngine {
  private testFilePath: string;
  private envName: string;
  private enableCodegen: boolean;

  constructor(options: ApiEngineOptions) {
    this.testFilePath = options.testFilePath;
    this.envName = options.env;
    this.enableCodegen =
      options.enableCodegen ??
      ConfigManager.getInstance().get('framework.apiCodegenEnabled', true);
  }

  private loadEnvironment(): Record<string, unknown> {
    const envPath = path.join(process.cwd(), 'resources', 'config', 'environments', `${this.envName}.json`);
    if (!fs.existsSync(envPath)) {
      throw new Error(`Environment config not found: ${envPath}`);
    }
    const raw = JSON.parse(fs.readFileSync(envPath, 'utf8'));
    const str = JSON.stringify(raw);
    const interpolated = str.replace(/\${(\w+)}/g, (_, name) => {
      return process.env[name] ?? `\${${name}}`;
    });
    const config = JSON.parse(interpolated);
    return {
      baseUrl: config.baseUrl,
      apiBaseUrl: config.apiBaseUrl,
      ...config.variables,
      ...config.credentials,
      ...(config.apiAuth && typeof config.apiAuth === 'object' ? config.apiAuth : {}),
    };
  }

  private resolveAuthPlan(scenarioAuth?: ApiAuthPlan): ApiAuthPlan {
    const cfg = ConfigManager.getInstance().getAll() as {
      api?: { auth?: { bearerEnv?: string; apiKeyEnv?: string } };
    };
    if (scenarioAuth) return scenarioAuth;
    return {
      type: 'bearer',
      envVar: cfg.api?.auth?.bearerEnv || 'AUTH_TOKEN',
    };
  }

  public async execute(): Promise<EngineRunResult> {
    const startedAt = Date.now();
    const llm = new LLMClient();
    let scenario = await ApiTestParser.parseFile(this.testFilePath, llm);

    if (scenario.needsLlm || scenario.steps.length === 0) {
      Logger.info('Parsing API scenario with LLM...');
      const content = fs.readFileSync(this.testFilePath, 'utf8');
      const steps = await ApiTestParser.parseWithLlm(content, llm);
      scenario = { ...scenario, steps, needsLlm: false };
    }

    if (scenario.steps.length === 0) {
      throw new Error('No API steps could be parsed from the test source.');
    }

    const envVars = this.loadEnvironment();
    const variables: Record<string, unknown> = {
      baseUrl: envVars.baseUrl,
      apiBaseUrl: envVars.apiBaseUrl,
      ...scenario.variables,
      ...envVars,
    };

    // Inject auth secrets into variables for {{AUTH_TOKEN}} style headers
    const auth = this.resolveAuthPlan(scenario.auth);
    if (auth.envVar && process.env[auth.envVar]) {
      variables[auth.envVar] = process.env[auth.envVar];
    }
    const cfg = ConfigManager.getInstance().getAll() as {
      api?: { auth?: { apiKeyEnv?: string } };
    };
    const apiKeyEnv = cfg.api?.auth?.apiKeyEnv || 'API_KEY';
    if (process.env[apiKeyEnv]) variables[apiKeyEnv] = process.env[apiKeyEnv];

    const baseURL = String(variables.apiBaseUrl ?? variables.baseUrl ?? '');
    const authHeaders = resolveApiAuthHeaders(auth);
    const requestContext = await playwrightRequest.newContext({
      baseURL: baseURL || undefined,
      extraHTTPHeaders: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      ignoreHTTPSErrors: true,
    });

    const slug = path.basename(this.testFilePath, path.extname(this.testFilePath));
    let success = false;
    let stepsExecuted = 0;

    try {
      const apiContext = new ApiContext(requestContext, variables, process.cwd());
      const runner = new ApiRunnerPlaywright(apiContext);
      const result = await runner.runPipeline(scenario.steps);
      success = result.success;
      stepsExecuted = result.steps.length;

      ensureReportDirs();
      const reportName = slug;
      fs.writeFileSync(
        apiReportPath(reportName, Date.now()),
        JSON.stringify({ scenario: scenario.name, result }, null, 2),
        'utf8'
      );

      const durationMs = Date.now() - startedAt;
      const reportSummary = {
        test: slug,
        status: success ? 'PASSED' : 'FAILED',
        timestamp: new Date().toISOString(),
        stepsExecuted,
        kind: 'api',
        summary: success
          ? `API suite passed (${stepsExecuted} steps)`
          : `API suite failed after ${stepsExecuted} step(s)`,
        durationMs,
        scenario: scenario.name,
        sourceRef: scenario.sourceRef,
      };
      fs.writeFileSync(summaryPath(slug), JSON.stringify(reportSummary, null, 2), 'utf8');

      try {
        archiveCurrentRun(slug);
      } catch {
        // history is best-effort
      }

      try {
        await generateExecutionReports({
          testSlugs: [slug],
          env: this.envName,
          testFilePath: this.testFilePath,
          suiteName: `WebPilot API — ${scenario.name}`,
        });
      } catch (reportErr: unknown) {
        const msg = reportErr instanceof Error ? reportErr.message : String(reportErr);
        Logger.warn(`HTML report generation skipped: ${msg}`);
      }

      if (this.enableCodegen && result.success) {
        const files = ApiCodegenService.generate(scenario, scenario.steps, result.steps);
        fs.mkdirSync(path.join(process.cwd(), 'packages', 'test-framework', 'apis'), { recursive: true });
        CodegenWriter.writeFiles(files);
        Logger.info(`Generated ${files.length} API automation file(s).`);
      }

      try {
        const { AdoResultPublisher } = require('../integrations/ado/AdoResultPublisher');
        await AdoResultPublisher.maybeAutoPublish(slug, false);
      } catch (adoErr: unknown) {
        const msg = adoErr instanceof Error ? adoErr.message : String(adoErr);
        Logger.warn(`ADO auto-publish skipped: ${msg}`);
      }

      return { success, stepsExecuted };
    } finally {
      await requestContext.dispose();
    }
  }
}
