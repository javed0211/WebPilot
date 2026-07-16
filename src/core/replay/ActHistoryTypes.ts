export type ActLocatorKind =
  | 'role'
  | 'label'
  | 'placeholder'
  | 'testid'
  | 'text'
  | 'css'
  | 'xpath'
  | string;

export interface ActLocator {
  kind: ActLocatorKind;
  value?: string;
  name?: string;
  tag?: string;
  /** When multiple matches exist, narrow with hasText / exact text filter. */
  filterText?: string;
}

export interface ActStep {
  index: number;
  action: string;
  selector?: string | null;
  value?: string | null;
  url?: string | null;
  description?: string;
  pageTitle?: string | null;
  elementIndex?: number | null;
  locators?: ActLocator[];
  agentStep?: number | null;
  actionParams?: Record<string, unknown>;
}

export interface AssertionPlanItem {
  index: number;
  kind: 'assert' | 'screenshot' | string;
  nlStep: string;
}

export interface ActRunLog {
  schemaVersion?: number;
  isSuccessful?: boolean;
  isDone?: boolean;
  errors?: unknown[];
  actionNames?: string[];
  healing?: ActHealingRecord[];
  failures?: string[];
}

export interface ActHealingRecord {
  stepIndex: number;
  action: string;
  url?: string;
  brokenSelector?: string;
  healedSelector?: string;
  confidence?: number;
  reasoning?: string;
  proposalPath?: string;
  at: string;
}

export interface ActHistoryDocument {
  test?: string;
  testName?: string;
  nlSteps?: string[];
  historySource?: string;
  actHistory?: ActStep[];
  executionHistory?: ActStep[];
  assertionPlan?: AssertionPlanItem[];
  runLog?: ActRunLog;
  urlSequence?: string[];
  /** Top-level discovery success — trusted over later replay/heal runLog.failures. */
  isSuccessful?: boolean;
  isDone?: boolean;
}

export interface ActReplayStepResult {
  index: number;
  action: string;
  ok: boolean;
  error?: string;
  healed?: boolean;
  locatorUsed?: string;
  screenshotPath?: string;
}

export interface ActReplayResult {
  success: boolean;
  slug: string;
  stepsExecuted: number;
  stepResults: ActReplayStepResult[];
  failure?: string;
  healedCount: number;
  videoPath?: string;
  screenshotPaths?: string[];
}
