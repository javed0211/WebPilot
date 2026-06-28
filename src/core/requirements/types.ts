/**
 * Feature 09: Requirements Coverage and Regression Manager — shared types.
 *
 * These types describe the normalized requirement model (independent of the
 * source system), the coverage model computed against the local test suite,
 * and the reconciliation results for existing mappings/tags.
 */

export type RequirementSource = 'ado' | 'jira' | 'import';

export type RequirementPriority = 'P0' | 'P1' | 'P2' | 'P3' | (string & {});

export interface AcceptanceCriterion {
  /** Stable id within the requirement, e.g. `AC1`. */
  id: string;
  text: string;
}

export interface RequirementLinks {
  parent?: string;
  testCases?: string[];
  bugs?: string[];
}

/**
 * Source-agnostic requirement. ADO work items and Jira issues both normalize
 * into this shape so coverage logic never needs to know the origin system.
 */
export interface NormalizedRequirement {
  id: string;
  source: RequirementSource;
  sourceUrl?: string;
  type?: string;
  title: string;
  description?: string;
  acceptanceCriteria: AcceptanceCriterion[];
  priority?: RequirementPriority;
  state?: string;
  team?: string;
  sprint?: string;
  release?: string;
  tags: string[];
  links: RequirementLinks;
  updatedAt?: string;
}

export interface RequirementScope {
  source?: RequirementSource;
  project?: string;
  team?: string;
  sprint?: string;
  release?: string;
  epic?: string;
  backlog?: boolean;
}

export interface RequirementSet {
  version: 1;
  generatedAt: string;
  scope: RequirementScope;
  requirements: NormalizedRequirement[];
}

// ---------------------------------------------------------------------------
// Live source sync model
// ---------------------------------------------------------------------------

export interface McpServerCommandConfig {
  enabled?: boolean;
  /** Stdio MCP server command, e.g. `npx` or an absolute binary path. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Explicit MCP tool to call. If omitted, WebPilot picks a likely query tool. */
  toolName?: string;
  /** Argument key that receives the generated WIQL/JQL query. */
  queryArgument?: string;
  /** Optional JSON payload template. `{{query}}`, `{{project}}`, etc. are replaced. */
  payloadTemplate?: Record<string, unknown>;
  /** Dot path to the array/object containing work items/issues in the tool result. */
  resultPath?: string;
}

export interface RequirementsSyncConfig {
  mcp?: {
    timeoutMs?: number;
    ado?: McpServerCommandConfig;
    jira?: McpServerCommandConfig;
  };
}

export interface RequirementsSyncOptions {
  source: Exclude<RequirementSource, 'import'>;
  scope: RequirementScope;
  merge?: boolean;
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Coverage model
// ---------------------------------------------------------------------------

export type CoverageState = 'covered' | 'partial' | 'uncovered';

export type CoverageEvidenceKind =
  | 'mapping'
  | 'tag'
  | 'semantic-step'
  | 'title-match'
  | 'execution-pass'
  | 'execution-fail';

export interface TestEvidence {
  /** Repo-relative path to the test/spec providing coverage. */
  path: string;
  /** 1-based step numbers in a natural-language test that matched, if any. */
  steps?: number[];
  /** Why this test is considered evidence. */
  evidence: CoverageEvidenceKind[];
  /** Most recent known execution status for this test, if any. */
  lastStatus?: string;
  /** 0..1 flake score (higher = flakier). */
  flakeScore?: number;
  /** 0..1 match score for this single test against the criterion. */
  score: number;
}

export interface CriterionCoverage {
  criterionId: string;
  text: string;
  status: CoverageState;
  /** 0..1 aggregate confidence for this criterion. */
  score: number;
  tests: TestEvidence[];
}

export type RequirementRisk = 'low' | 'medium' | 'high';

export interface RequirementCoverage {
  requirementId: string;
  title: string;
  priority?: RequirementPriority;
  status: CoverageState;
  /** 0..1 aggregate confidence across acceptance criteria. */
  confidence: number;
  criteria: CriterionCoverage[];
  /** Human-readable descriptions of what is missing. */
  gaps: string[];
  risk: RequirementRisk;
}

export interface CoverageReport {
  version: 1;
  generatedAt: string;
  scope: RequirementScope;
  summary: {
    requirements: number;
    covered: number;
    partial: number;
    uncovered: number;
    coveragePct: number;
    highRisk: number;
  };
  requirements: RequirementCoverage[];
}

// ---------------------------------------------------------------------------
// Mapping file + reconciliation
// ---------------------------------------------------------------------------

export type MappingConfidence = 'confirmed' | 'proposed' | 'rejected';

export interface MappingTestRef {
  path: string;
  steps?: number[];
}

export interface MappingCriterionEntry {
  /** Free text of the acceptance criterion this mapping targets. */
  text: string;
  /** Optional stable criterion id when known. */
  criterionId?: string;
  tests: MappingTestRef[];
  status: MappingConfidence;
}

export interface MappingRequirementEntry {
  criteria: MappingCriterionEntry[];
}

export interface RequirementMapFile {
  version: 1;
  requirements: Record<string, MappingRequirementEntry>;
}

export type ReconcileStatus =
  | 'valid'
  | 'stale'
  | 'broken'
  | 'orphan'
  | 'conflict'
  | 'low-quality';

export interface ReconcileFinding {
  requirementId: string;
  criterionText: string;
  testPath: string;
  status: ReconcileStatus;
  detail: string;
  /** Suggested correction the user can accept. */
  suggestion?: string;
}

export interface ReconcileReport {
  version: 1;
  generatedAt: string;
  findings: ReconcileFinding[];
  summary: Record<ReconcileStatus, number>;
}
