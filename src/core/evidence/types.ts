/**
 * Feature 11 — EvidenceBundle schema (governance-grade run evidence).
 */

export const EVIDENCE_BUNDLE_SCHEMA_VERSION = 1 as const;

export type EvidenceOutcome = 'PASSED' | 'FAILED' | 'SKIPPED' | 'UNKNOWN';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type CompletenessGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface EvidenceLocator {
  kind?: string;
  value?: string;
  name?: string;
  used?: string;
  verified?: boolean;
  verifiedBy?: string;
  matchCount?: number;
  confidence?: number;
}

export interface EvidenceStepAfter {
  url?: string | null;
  pageFingerprint?: string | null;
  inventoryChanged?: boolean;
}

export interface EvidenceTimelineStep {
  index: number;
  nlStep?: string;
  action: string;
  url?: string | null;
  pageTitle?: string | null;
  control?: {
    accessibleName?: string;
    tag?: string;
    elementIndex?: number | null;
  };
  locator?: EvidenceLocator | null;
  outcome: EvidenceOutcome;
  startedAt?: string;
  durationMs?: number;
  after?: EvidenceStepAfter | null;
  assertion?: { kind?: string; nlStep?: string; strength?: string } | null;
  healed: boolean;
  screenshotPath?: string | null;
  error?: string | null;
}

export interface EvidenceAssertionSummary {
  planned: number;
  executed: number;
  strong: number;
  weak: number;
  items: Array<{ index: number; kind?: string; nlStep?: string; strength?: string }>;
}

export interface EvidenceLocatorSummary {
  total: number;
  verified: number;
  unverified: number;
  verifiedRatio: number;
}

export interface EvidenceHealingRecord {
  stepIndex: number;
  brokenSelector?: string;
  healedSelector?: string;
  confidence?: number;
  reasoning?: string;
  proposalPath?: string;
  at?: string;
  classification?: string;
  committed?: boolean;
}

export interface EvidenceHealingSummary {
  count: number;
  records: EvidenceHealingRecord[];
}

export interface EvidencePageDrift {
  pageKey: string;
  previousFingerprint?: string;
  currentFingerprint?: string;
  added?: number;
  removed?: number;
  changed?: number;
}

export interface EvidencePageInventory {
  pagesTouched: string[];
  drift: EvidencePageDrift[];
}

export interface EvidenceCodegen {
  mode?: string;
  auditPath?: string;
  quality?: 'good' | 'degraded';
  qualityReasons?: string[];
  pomMappedStepRatio?: number;
  rawFallbackUsed?: boolean;
}

export interface EvidenceLlmPhase {
  llmCalls?: number;
  estimatedCostUsd?: number;
  totalTokens?: number;
}

export interface EvidenceLlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  llmCalls: number;
  phases?: Record<string, EvidenceLlmPhase>;
}

export interface EvidenceFlake {
  category?: string | null;
  confidence?: number | null;
  likelyCause?: string | null;
  recommendation?: string | null;
}

export interface EvidenceArtifacts {
  executionHistory?: string;
  summary?: string;
  video?: string;
  trace?: string;
  screenshots: string[];
  codegenAudit?: string;
  eventBundle?: string;
  evidenceBundle?: string;
}

export interface CompletenessReport {
  grade: CompletenessGrade;
  score: number;
  missing: string[];
  warnings: string[];
}

export interface RiskFactor {
  id: string;
  weight: number;
  detail: string;
}

export interface RiskReport {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
}

export interface EvidenceBundle {
  schemaVersion: typeof EVIDENCE_BUNDLE_SCHEMA_VERSION;
  runId: string;
  slug: string;
  testFile?: string;
  status: EvidenceOutcome;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  executionMode?: string;
  environment?: { name?: string; baseUrl?: string };
  browser?: { target?: string; provider?: string; headless?: boolean };

  timeline: EvidenceTimelineStep[];
  assertions: EvidenceAssertionSummary;
  locators: EvidenceLocatorSummary;
  healing: EvidenceHealingSummary;
  pageInventory: EvidencePageInventory;
  codegen: EvidenceCodegen;
  llmUsage: EvidenceLlmUsage;
  flake: EvidenceFlake;
  artifacts: EvidenceArtifacts;
  completeness: CompletenessReport;
  risk: RiskReport;

  /** Optional grounded root-cause summary status. */
  rootCauseStatus?: 'grounded' | 'insufficient_evidence';
}

export interface RiskWeights {
  failWeight: number;
  flakeHighConfidence: number;
  healingPerStep: number;
  healingCap: number;
  codegenDegraded: number;
  unverifiedLocatorMax: number;
  weakAssertionOnly: number;
  missingFailureArtifacts: number;
  pageDrift: number;
  highLlmSpend: number;
}

export interface CompletenessThresholds {
  requireVerifiedLocatorRatio: number;
  requireTraceOnFailure: boolean;
  requireAssertionOnPass: boolean;
}

export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
  failWeight: 40,
  flakeHighConfidence: 25,
  healingPerStep: 10,
  healingCap: 25,
  codegenDegraded: 20,
  unverifiedLocatorMax: 20,
  weakAssertionOnly: 15,
  missingFailureArtifacts: 10,
  pageDrift: 10,
  highLlmSpend: 5,
};

export const DEFAULT_COMPLETENESS_THRESHOLDS: CompletenessThresholds = {
  requireVerifiedLocatorRatio: 0.8,
  requireTraceOnFailure: true,
  requireAssertionOnPass: true,
};
