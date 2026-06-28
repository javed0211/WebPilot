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
import { ApiContext } from '../../packages/test-framework/core/ApiContext';
import { EngineRunResult } from './Engine';
import { apiReportPath, ensureReportDirs } from './ReportPaths';

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
      ...config.credentials
    };
  }

  public async execute(): Promise<EngineRunResult> {
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
      ...envVars
    };

    const baseURL = String(variables.apiBaseUrl ?? variables.baseUrl ?? '');
    const requestContext = await playwrightRequest.newContext({
      baseURL: baseURL || undefined,
      extraHTTPHeaders: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(process.env.AUTH_TOKEN
          ? { Authorization: `Bearer ${process.env.AUTH_TOKEN}` }
          : {})
      },
      ignoreHTTPSErrors: true
    });

    try {
      const apiContext = new ApiContext(requestContext, variables);
      const runner = new ApiRunnerPlaywright(apiContext);
      const result = await runner.runPipeline(scenario.steps);

      ensureReportDirs();
      const reportName = path.basename(this.testFilePath, path.extname(this.testFilePath));
      fs.writeFileSync(
        apiReportPath(reportName, Date.now()),
        JSON.stringify({ scenario: scenario.name, result }, null, 2),
        'utf8'
      );

      if (this.enableCodegen && result.success) {
        const files = ApiCodegenService.generate(scenario, scenario.steps, result.steps);
        fs.mkdirSync(path.join(process.cwd(), 'packages', 'test-framework', 'apis'), { recursive: true });
        CodegenWriter.writeFiles(files);
        Logger.info(`Generated ${files.length} API automation file(s).`);
      }

      return { success: result.success, stepsExecuted: scenario.steps.length };
    } finally {
      await requestContext.dispose();
    }
  }
}
