import * as fs from 'fs';

export interface UsageSnapshot {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  llmCalls: number;
}

export interface UsageFilePayload {
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  llmCalls: number;
  sources?: string[];
}

/**
 * Accumulates token usage and estimated cost across all LLM calls in a job.
 */
export class UsageTracker {
  private static promptTokens = 0;
  private static completionTokens = 0;
  private static estimatedCostUsd = 0;
  private static llmCalls = 0;

  public static reset(): void {
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.estimatedCostUsd = 0;
    this.llmCalls = 0;
  }

  public static record(usage: {
    promptTokens: number;
    completionTokens: number;
    cost: number;
  }): void {
    const prompt = Math.max(0, usage.promptTokens);
    const completion = Math.max(0, usage.completionTokens);
    this.promptTokens += prompt;
    this.completionTokens += completion;
    this.estimatedCostUsd += usage.cost;
    this.llmCalls += 1;
  }

  public static ingest(snapshot: UsageFilePayload): void {
    this.promptTokens += snapshot.promptTokens ?? 0;
    this.completionTokens += snapshot.completionTokens ?? 0;
    this.estimatedCostUsd += snapshot.estimatedCostUsd ?? 0;
    this.llmCalls += snapshot.llmCalls ?? 0;
  }

  public static loadFromFile(filePath: string): boolean {
    if (!fs.existsSync(filePath)) return false;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as UsageFilePayload;
      this.ingest(data);
      return true;
    } catch {
      return false;
    }
  }

  public static getSnapshot(): UsageSnapshot {
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.promptTokens + this.completionTokens,
      estimatedCostUsd: this.estimatedCostUsd,
      llmCalls: this.llmCalls
    };
  }
}
