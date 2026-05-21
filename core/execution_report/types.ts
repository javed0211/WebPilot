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
  artifacts: ReportArtifacts;
  pricing: ReportPricing;
  executionHistoryPath?: string;
  isAgentSuccessful?: boolean;
  isAgentDone?: boolean;
  aiAnalysis?: string;
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
  suiteAiAnalysis?: string;
}
