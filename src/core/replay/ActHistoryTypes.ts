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
  /**
   * Playwright getByRole/getByText exact name match.
   * Required for short AX names that substring-match unrelated nodes.
   */
  exact?: boolean;
  /**
   * Ancestor/container that scopes the leaf locator (nav, main, dialog, …).
   */
  scope?: ActLocator;
  /** True when uniqueness was proven against a page inventory snapshot (matchCount===1). */
  verified?: boolean;
  /** Number of matches observed during DOM verification (1 when verified). */
  matchCount?: number;
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
  /** Change classification — defaults to inconclusive for legacy records. */
  classification?:
    | 'likely_intentional_refactor'
    | 'possible_regression'
    | 'inconclusive';
  classificationConfidence?: number;
  classificationReasons?: string[];
  /** Transaction state after post-action validation. */
  state?:
    | 'proposed'
    | 'candidate_verified'
    | 'action_attempted'
    | 'post_action_validated'
    | 'committed'
    | 'rejected'
    | 'quarantined'
    | 'legacy';
  committed?: boolean;
  validationEventIds?: string[];
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
