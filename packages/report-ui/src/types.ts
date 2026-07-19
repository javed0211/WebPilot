export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type CompletenessGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export interface RiskFactor { id: string; weight: number; detail: string }
export interface RiskReport { score: number; level: RiskLevel; factors: RiskFactor[] }
export interface CompletenessReport { grade: CompletenessGrade; score: number; missing: string[]; warnings: string[] }
export interface EvidenceLocator { kind?: string; value?: string; name?: string; used?: string; planned?: string; verified?: boolean; verifiedBy?: string; matchCount?: number; confidence?: number }
export interface EvidenceTimelineStep {
  index: number; nlStep?: string; action: string; url?: string | null; pageTitle?: string | null;
  control?: { accessibleName?: string; tag?: string; elementIndex?: number | null };
  locator?: EvidenceLocator | null; attemptedLocators?: string[]; outcome?: string; startedAt?: string; durationMs?: number;
  after?: { url?: string | null; pageFingerprint?: string | null; inventoryChanged?: boolean } | null;
  assertion?: { kind?: string; nlStep?: string; strength?: string; expected?: string; actual?: string } | null; healed: boolean;
  screenshotPath?: string | null; error?: string | null; failureReason?: string | null;
  httpMethod?: string; httpStatus?: number; expectedStatus?: number; responsePreview?: string | null;
}
export interface EvidenceLocatorSummary { total: number; verified: number; unverified: number; verifiedRatio: number | null }
export interface EvidenceHealingRecord { stepIndex: number; brokenSelector?: string; healedSelector?: string; confidence?: number; reasoning?: string; proposalPath?: string; at?: string; classification?: string; committed?: boolean }
export interface EvidencePageDrift { pageKey: string; previousFingerprint?: string; currentFingerprint?: string; added?: number; removed?: number; changed?: number }
export interface RootCauseFinding {
  findingId?: string; claim: string; claimType?: string; confidence: number; causeEventIds?: string[];
  citedEventIds?: string[]; supportingEventIds?: string[]; contradictoryEventIds?: string[];
}
export interface RootCauseAnalysis {
  schemaVersion?: string; status: 'grounded' | 'insufficient_evidence' | 'not-required' | string;
  summary: string; findings: RootCauseFinding[]; missingEvidence?: string[]; runId?: string; scenarioId?: string; analyzedAt?: string;
}
export interface Pricing { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd: number; llmCalls: number; model?: string; provider?: string }
export interface Artifacts { video?: string; trace?: string; screenshots: string[]; eventBundle?: string; evidenceBundle?: string }
export interface Step { index: number; action: string; selector?: string | null; value?: string | null; url?: string | null; description: string }
export interface History {
  runId: string; timestamp: string; status: string; stepsExecuted: number; pricing: Pricing; flakeCategory?: string;
  executionMode?: string; browserProvider?: string; retryCount?: number; retries?: number; attempts?: number;
  knowledge?: { reusedSteps: number; learnedSteps: number };
}
export interface TestCaseReport {
  slug: string; testName: string; testFile?: string; status: string; timestamp: string; stepsExecuted: number;
  kind?: 'web' | 'api' | string; executionMode?: string; statusReason?: string; failureContext?: string;
  durationMs?: number; totalDurationMs?: number; nlSteps: string[]; executionSteps: Step[]; urlSequence: string[];
  runtimeInsights: {type?: string; message?: string; required?: boolean}[]; codegenSummary: string | string[];
  artifacts: Artifacts; pricing: Pricing; runHistory: History[]; executionHistoryPath?: string;
  isAgentSuccessful?: boolean; isAgentDone?: boolean; browserProvider?: Record<string, unknown>; codegen?: Record<string, unknown>;
  risk?: RiskReport; completeness?: CompletenessReport; healingCount?: number; codegenQuality?: 'good' | 'degraded' | string;
  evidenceRef?: string; evidenceTimeline?: EvidenceTimelineStep[]; evidenceHealing?: EvidenceHealingRecord[];
  evidenceLocators?: EvidenceLocatorSummary; evidenceDrift?: EvidencePageDrift[]; rootCauseAnalysis?: RootCauseAnalysis;
  aiAnalysis?: string; flakeAnalysis?: Record<string, unknown>;
}
export interface SuiteExecutionReport {
  generatedAt: string; suiteName: string;
  environment: {name: string; baseUrl?: string; apiBaseUrl?: string};
  browser: {target: string; channel?: string; headless: boolean; viewport?: {width:number;height:number}; video:string; trace:string; screenshots:string; provider?: Record<string, unknown>};
  framework: {name:string; version:string; useBrowserUse:boolean; activeProvider:string};
  testCases: TestCaseReport[];
  overview: {
    total:number; passed:number; failed:number; passRate:number; totalSteps:number; totalCostUsd:number; totalTokens:number;
    executed?: number; skipped?: number; cancelled?: number; retryRate?: number; totalDurationMs?: number;
    generatedTests?: number; estimatedHoursSaved?: number;
  };
  historyOverview: {totalRuns:number; promptTokens:number; completionTokens:number; totalTokens:number; totalCostUsd:number; llmCalls:number};
  suiteAiAnalysis?: string; totalDurationMs?: number; generatedTests?: number; estimatedHoursSaved?: number;
}
export type Report = SuiteExecutionReport;
export type TestCase = TestCaseReport;
