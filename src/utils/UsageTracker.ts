import * as fs from 'fs';
import { estimateCostUsd } from './ModelPricing';

export type UsagePhase = 'design' | 'execution' | 'healing' | 'codegen' | 'analysis';

export interface PhaseUsage {
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  llmCalls: number;
}

export interface UsageSnapshot {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  llmCalls: number;
  phases: Record<string, PhaseUsage>;
}

export interface UsageFilePayload {
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  llmCalls: number;
  sources?: string[];
  phases?: Record<string, PhaseUsage>;
}

function emptyPhase(): PhaseUsage {
  return { promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0, llmCalls: 0 };
}

/**
 * Accumulates token usage and estimated cost across all LLM calls in a job.
 */
export class UsageTracker {
  private static promptTokens = 0;
  private static completionTokens = 0;
  private static estimatedCostUsd = 0;
  private static llmCalls = 0;

  private static currentPhase: UsagePhase = 'design';
  private static phaseData: Record<string, PhaseUsage> = {
    design: emptyPhase(),
    execution: emptyPhase(),
    healing: emptyPhase(),
    codegen: emptyPhase(),
    analysis: emptyPhase(),
  };

  private static ensurePhase(phase: string): PhaseUsage {
    if (!this.phaseData[phase]) {
      this.phaseData[phase] = emptyPhase();
    }
    return this.phaseData[phase];
  }

  private static addToTotals(
    prompt: number,
    completion: number,
    cost: number,
    calls: number,
    phase: string
  ): void {
    this.promptTokens += prompt;
    this.completionTokens += completion;
    this.estimatedCostUsd += cost;
    this.llmCalls += calls;

    const bucket = this.ensurePhase(phase);
    bucket.promptTokens += prompt;
    bucket.completionTokens += completion;
    bucket.estimatedCostUsd += cost;
    bucket.llmCalls += calls;
  }

  public static setPhase(phase: UsagePhase): void {
    this.currentPhase = phase;
    this.ensurePhase(phase);
  }

  public static getPhase(): UsagePhase {
    return this.currentPhase;
  }

  public static reset(): void {
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.estimatedCostUsd = 0;
    this.llmCalls = 0;
    this.currentPhase = 'design';
    this.phaseData = {
      design: emptyPhase(),
      execution: emptyPhase(),
      healing: emptyPhase(),
      codegen: emptyPhase(),
      analysis: emptyPhase(),
    };
  }

  public static record(usage: {
    promptTokens: number;
    completionTokens: number;
    cost: number;
  }): void {
    const prompt = Math.max(0, usage.promptTokens);
    const completion = Math.max(0, usage.completionTokens);
    this.addToTotals(prompt, completion, usage.cost, 1, this.currentPhase);
  }

  public static ingest(snapshot: UsageFilePayload): void {
    this.loadExecutionFromFile(snapshot);
  }

  /** Load browser-use execution usage without double-counting codegen phases. */
  public static loadExecutionFromFile(filePathOrPayload: string | UsageFilePayload): boolean {
    let data: UsageFilePayload;
    if (typeof filePathOrPayload === 'string') {
      if (!fs.existsSync(filePathOrPayload)) return false;
      try {
        data = JSON.parse(fs.readFileSync(filePathOrPayload, 'utf8')) as UsageFilePayload;
      } catch {
        return false;
      }
    } else {
      data = filePathOrPayload;
    }

    const executionPhase = data.phases?.execution;
    const prompt = executionPhase?.promptTokens ?? data.promptTokens ?? 0;
    const completion = executionPhase?.completionTokens ?? data.completionTokens ?? 0;
    let cost = executionPhase?.estimatedCostUsd ?? data.estimatedCostUsd ?? 0;
    const calls = executionPhase?.llmCalls ?? data.llmCalls ?? 0;

    // Estimate if Python persisted tokens without a priced cost (common for Azure deployments).
    if (cost <= 0 && prompt + completion > 0) {
      cost = estimateCostUsd(process.env.WEBPILOT_LLM_MODEL || 'gpt-4.1', prompt, completion);
    }

    this.addToTotals(prompt, completion, cost, calls, 'execution');
    return prompt + completion > 0 || calls > 0;
  }

  public static loadFromFile(filePath: string): boolean {
    return UsageTracker.loadExecutionFromFile(filePath);
  }

  public static getSnapshot(): UsageSnapshot {
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.promptTokens + this.completionTokens,
      estimatedCostUsd: this.estimatedCostUsd,
      llmCalls: this.llmCalls,
      phases: { ...this.phaseData },
    };
  }
}
