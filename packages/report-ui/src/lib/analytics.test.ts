import { describe, expect, it } from 'vitest';
import {
  aggregateRuns,
  computeInsights,
  failureCauses,
  hasEvidence,
  historyStats,
  suiteGovernance,
} from './analytics';
import type { Report, TestCase } from '../types';

const pricing = {
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
  estimatedCostUsd: 0.01,
  llmCalls: 2,
};

function baseTest(partial: Partial<TestCase>): TestCase {
  return {
    slug: 't1',
    testName: 'Sample',
    status: 'PASSED',
    timestamp: '2026-07-19T10:00:00.000Z',
    stepsExecuted: 5,
    nlSteps: [],
    executionSteps: [],
    urlSequence: [],
    runtimeInsights: [],
    codegenSummary: '',
    artifacts: { screenshots: [] },
    pricing,
    runHistory: [],
    ...partial,
  };
}

const fullEvidence: TestCase = baseTest({
  status: 'FAILED',
  risk: {
    score: 72,
    level: 'high',
    factors: [{ id: 'assertion-failed', weight: 30, detail: 'Final assert failed' }],
  },
  completeness: { grade: 'C', score: 68, missing: [], warnings: [] },
  healingCount: 1,
  evidenceLocators: { total: 9, verified: 5, unverified: 4, verifiedRatio: 0.56 },
  evidenceHealing: [
    {
      stepIndex: 8,
      brokenSelector: '#old',
      healedSelector: '#new',
      confidence: 0.9,
      classification: 'refactor',
      committed: true,
    },
  ],
  evidenceTimeline: [
    {
      index: 10,
      action: 'assert',
      outcome: 'FAILED',
      healed: false,
      error: 'Confirmation timeout',
    },
  ],
  rootCauseAnalysis: {
    status: 'grounded',
    summary: 'Confirmation never appeared',
    findings: [
      { claim: 'Selector renamed', confidence: 0.9, citedEventIds: ['e1'] },
      { claim: 'Backend delay', confidence: 0.4, citedEventIds: [] },
    ],
  },
  runHistory: [
    {
      runId: 'r1',
      timestamp: '2026-07-17T10:00:00.000Z',
      status: 'FAILED',
      stepsExecuted: 4,
      pricing,
    },
    {
      runId: 'r2',
      timestamp: '2026-07-18T10:00:00.000Z',
      status: 'PASSED',
      stepsExecuted: 5,
      pricing,
      retryCount: 1,
    },
    {
      runId: 'r3',
      timestamp: '2026-07-19T10:00:00.000Z',
      status: 'FAILED',
      stepsExecuted: 5,
      pricing,
    },
  ],
});

const minimal: TestCase = baseTest({ slug: 'min', testName: 'Minimal' });

const report: Report = {
  generatedAt: '2026-07-19T12:00:00.000Z',
  suiteName: 'Fixture suite',
  environment: { name: 'qa' },
  browser: {
    target: 'chromium',
    headless: true,
    video: 'off',
    trace: 'off',
    screenshots: 'off',
  },
  framework: {
    name: 'WebPilot',
    version: '1.0.0',
    useBrowserUse: true,
    activeProvider: 'local',
  },
  testCases: [fullEvidence, minimal],
  overview: {
    total: 2,
    passed: 1,
    failed: 1,
    passRate: 50,
    totalSteps: 10,
    totalCostUsd: 0.02,
    totalTokens: 300,
  },
  historyOverview: {
    totalRuns: 3,
    promptTokens: 300,
    completionTokens: 150,
    totalTokens: 450,
    totalCostUsd: 0.03,
    llmCalls: 6,
  },
};

describe('analytics fixtures', () => {
  it('detects evidence on full reports and not on minimal ones', () => {
    expect(hasEvidence(fullEvidence)).toBe(true);
    expect(hasEvidence(minimal)).toBe(false);
  });

  it('computes history volatility and recovery for historical runs', () => {
    const stats = historyStats(fullEvidence);
    expect(stats.runs).toBe(3);
    expect(stats.transitions).toBe(2);
    expect(stats.failRate).toBeCloseTo(66.666, 0);
  });

  it('aggregates runs and failure causes from evidence', () => {
    expect(aggregateRuns(report).length).toBeGreaterThan(0);
    const causes = failureCauses(report);
    expect(causes.some((c) => /Confirmation|Selector|Backend/i.test(c.text))).toBe(true);
  });

  it('builds suite governance from worst-case risk', () => {
    const gov = suiteGovernance(report);
    expect(gov.worst?.level).toBe('high');
    expect(gov.lowestGrade).toBe('C');
    expect(gov.healed).toBe(1);
  });

  it('derives AI insights without fabricating unknown values', () => {
    const insights = computeInsights(report);
    expect(insights.confidence).toBe(65);
    expect(insights.preventable).toBe(1);
    expect(insights.recovered).toBe(1);
    expect(insights.learned).toBe(1);
    expect(insights.generated).toBeNull();
    expect(insights.saved).toBeNull();
  });

  it('handles malformed empty report safely', () => {
    const empty: Report = {
      ...report,
      testCases: [],
      overview: { ...report.overview, total: 0, passed: 0, failed: 0, passRate: 0 },
    };
    expect(aggregateRuns(empty)).toEqual([]);
    expect(failureCauses(empty)).toEqual([]);
    expect(suiteGovernance(empty).tests).toEqual([]);
    expect(suiteGovernance(empty).worst).toBeUndefined();
    expect(computeInsights(empty).confidence).toBeNull();
  });
});
