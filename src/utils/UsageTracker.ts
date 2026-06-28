import * as fs from 'fs';

export type UsagePhase = 'design' | 'execution' | 'healing';

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
    design: { promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0, llmCalls: 0 },
    execution: { promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0, llmCalls: 0 },
    healing: { promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0, llmCalls: 0 }
  };

  public static setPhase(phase: UsagePhase): void {
    this.currentPhase = phase;
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
      design: { promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0, llmCalls: 0 },
      execution: { promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0, llmCalls: 0 },
      healing: { promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0, llmCalls: 0 }
    };
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

    // Track by phase
    this.phaseData[this.currentPhase].promptTokens += prompt;
    this.phaseData[this.currentPhase].completionTokens += completion;
    this.phaseData[this.currentPhase].estimatedCostUsd += usage.cost;
    this.phaseData[this.currentPhase].llmCalls += 1;
  }

  public static ingest(snapshot: UsageFilePayload): void {
    this.promptTokens += snapshot.promptTokens ?? 0;
    this.completionTokens += snapshot.completionTokens ?? 0;
    this.estimatedCostUsd += snapshot.estimatedCostUsd ?? 0;
    this.llmCalls += snapshot.llmCalls ?? 0;

    if (snapshot.phases) {
      for (const [phase, data] of Object.entries(snapshot.phases)) {
        if (this.phaseData[phase as UsagePhase]) {
          this.phaseData[phase as UsagePhase].promptTokens += data.promptTokens ?? 0;
          this.phaseData[phase as UsagePhase].completionTokens += data.completionTokens ?? 0;
          this.phaseData[phase as UsagePhase].estimatedCostUsd += data.estimatedCostUsd ?? 0;
          this.phaseData[phase as UsagePhase].llmCalls += data.llmCalls ?? 0;
        }
      }
    }
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
      llmCalls: this.llmCalls,
      phases: { ...this.phaseData }
    };
  }
}
