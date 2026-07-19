/**
 * Feature 15 — grounded root-cause analysis contract.
 * Every claim must cite event IDs from the execution ledger.
 */

export const ROOT_CAUSE_SCHEMA_VERSION = 1 as const;

export type RootCauseStatus = 'grounded' | 'insufficient_evidence';

/** Claim categories used by CitationValidator kind checks. */
export type RootCauseClaimType =
  | 'network_error'
  | 'assertion_failure'
  | 'console_error'
  | 'action_failure'
  | 'healing_regression'
  | 'page_error'
  | 'generic';

export interface RootCauseFinding {
  findingId: string;
  claim: string;
  claimType: RootCauseClaimType;
  confidence: number;
  /** Primary causal events — must exist and temporally precede the effect. */
  causeEventIds: string[];
  supportingEventIds: string[];
  contradictoryEventIds?: string[];
}

export interface RootCauseAnalysis {
  schemaVersion: typeof ROOT_CAUSE_SCHEMA_VERSION;
  status: RootCauseStatus;
  summary: string;
  findings: RootCauseFinding[];
  missingEvidence?: string[];
  runId?: string;
  scenarioId?: string;
  analyzedAt: string;
}

export interface CitationIssue {
  findingId: string;
  code:
    | 'missing_event'
    | 'wrong_run'
    | 'temporal_violation'
    | 'unsupported_kind'
    | 'redacted_payload'
    | 'empty_causes'
    | 'invalid_structure';
  message: string;
  eventId?: string;
}

export interface CitationValidationResult {
  ok: boolean;
  issues: CitationIssue[];
  /** Findings that passed all citation rules. */
  accepted: RootCauseFinding[];
  /** Findings rejected (when failOnInvalidCitation, these are dropped). */
  rejected: RootCauseFinding[];
}

export interface RootCauseAnalyzeOptions {
  /** Absolute or project-relative path to `*_events.json`. */
  eventBundlePath?: string;
  /** Pre-loaded bundle (tests / in-memory). */
  bundle?: import('../events/ExecutionEvent').ExecutionEventBundle;
  /** Test / scenario status from summary. */
  status?: string;
  scenarioId?: string;
  /** Effect event to compare cause timestamps against (optional). */
  effectEventId?: string;
  /** Drop invalid findings instead of failing the whole analysis. Default true. */
  failOnInvalidCitation?: boolean;
  /** Optional LLM/proposed findings to validate and merge. */
  proposedFindings?: RootCauseFinding[];
}
