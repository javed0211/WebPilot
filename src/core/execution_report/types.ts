import { AssertionSummary } from '../assertions/AssertionCandidate';
import { FlakeAnalysis } from '../flake/FailureSignal';
import { BrowserSessionInfo } from '../browserProviders/BrowserProvider';

export interface ReportPricing {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  llmCalls: number;
  model?: string;
  provider?: string;
}

export interface ReportBrowser {
  target: string;
  channel?: string;
  headless: boolean;
  viewport?: { width: number; height: number };
  video: string;
  trace: string;
  screenshots: string;
  provider?: BrowserSessionInfo;
}

export interface ReportEnvironment {
  name: string;
  baseUrl?: string;
  apiBaseUrl?: string;
}

export interface ReportArtifacts {
  video?: string;
  trace?: string;
  screenshots: string[];
}

export interface ReportStep {
  index: number;
  action: string;
  selector?: string | null;
  value?: string | null;
  url?: string | null;
  description: string;
}

export interface TestRunHistory {
  runId: string;
  timestamp: string;
  status: string;
  executionMode?: string;
  stepsExecuted: number;
  pricing: ReportPricing;
  flakeCategory?: string;
  browserProvider?: string;
  knowledge?: {
    reusedSteps: number;
    learnedSteps: number;
  };
}

export interface ReportCodegenInfo {
  mode: 'deterministic' | 'llm' | 'auto' | 'reuse';
  specPath: string;
  pageObjectPaths: string[];
  metadataPath: string;
  tracePath: string;
  planPath: string;
  replayCommand: string;
  validationCommand?: string | null;
  assertionSummary?: AssertionSummary;
  generatedFiles: string[];
  notes?: string[];
}

export interface TestCaseReport {
  slug: string;
  testName: string;
  testFile?: string;
  status: string;
  timestamp: string;
  stepsExecuted: number;
  nlSteps: string[];
  executionSteps: ReportStep[];
  urlSequence: string[];
  runtimeInsights: { type?: string; message?: string; required?: boolean }[];
  codegenSummary: string | string[];
  codegen?: ReportCodegenInfo;
  artifacts: ReportArtifacts;
  pricing: ReportPricing;
  browserProvider?: BrowserSessionInfo;
  runHistory: TestRunHistory[];
  executionHistoryPath?: string;
  isAgentSuccessful?: boolean;
  isAgentDone?: boolean;
  aiAnalysis?: string;
  flakeAnalysis?: FlakeAnalysis;
}

export interface SuiteExecutionReport {
  generatedAt: string;
  suiteName: string;
  environment: ReportEnvironment;
  browser: ReportBrowser;
  framework: {
    name: string;
    version: string;
    useBrowserUse: boolean;
    activeProvider: string;
  };
  testCases: TestCaseReport[];
  overview: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    totalSteps: number;
    totalCostUsd: number;
    totalTokens: number;
  };
  historyOverview: {
    totalRuns: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    llmCalls: number;
  };
  suiteAiAnalysis?: string;
}
