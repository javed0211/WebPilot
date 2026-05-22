import { ApiContext } from '../../framework/core/ApiContext';
import { Logger } from '../../utils/Logger';
import { ApiExecutionResult, ApiRequestStep, ApiStepExecutionRecord } from './types';

export class ApiRunnerPlaywright {
  private context: ApiContext;
  private executionLog: ApiStepExecutionRecord[] = [];

  constructor(context: ApiContext) {
    this.context = context;
  }

  public async runPipeline(steps: ApiRequestStep[]): Promise<ApiExecutionResult> {
    Logger.info(`API pipeline (Playwright) — ${steps.length} step${steps.length === 1 ? '' : 's'}`);
    let success = true;
    this.executionLog = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      Logger.step(i + 1, steps.length, step.name);
      const url = this.context.resolveUrl(step.url);
      Logger.detail(`${step.method} ${url}`);

      const start = Date.now();
      const record: ApiStepExecutionRecord = {
        stepIndex: i,
        stepName: step.name,
        method: step.method,
        url,
        requestHeaders: step.headers,
        requestBody: step.body,
        status: 0,
        durationMs: 0,
        success: false
      };

      try {
        const response = await this.context.executeStep(step);
        record.status = response.status();
        record.durationMs = Date.now() - start;
        record.success = true;
        const preview = (await response.text()).slice(0, 500);
        record.responsePreview = preview;
        Logger.success(`Response ${record.status} (${record.durationMs}ms)`);
      } catch (err: unknown) {
        record.durationMs = Date.now() - start;
        record.error = err instanceof Error ? err.message : String(err);
        record.success = false;
        Logger.error(record.error);
        success = false;
      }

      this.executionLog.push(record);
      if (!record.success) {
        Logger.error('Aborting API pipeline');
        break;
      }
    }

    return {
      success,
      steps: this.executionLog,
      variables: this.context.getVariables()
    };
  }

  public getExecutionLog(): ApiStepExecutionRecord[] {
    return [...this.executionLog];
  }

  public getContext(): ApiContext {
    return this.context;
  }
}
