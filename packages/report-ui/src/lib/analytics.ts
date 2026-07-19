import type { Report, TestCase } from '../types';
import { arr, n, own } from './format';

export const hasEvidence = (t: TestCase): boolean => !!(t.risk || t.completeness || t.evidenceLocators || t.evidenceTimeline || t.evidenceHealing || t.evidenceDrift || t.rootCauseAnalysis);
const retriesFor = (h: TestCase['runHistory'][number]): number | undefined => h.retryCount ?? h.retries ?? (Number.isFinite(Number(h.attempts)) ? Math.max(0, Number(h.attempts) - 1) : undefined);

export function historyStats(t: TestCase, dropLatest = false) {
  const history = arr(t.runHistory).slice().sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
  if (dropLatest) history.pop();
  let transitions = 0, failed = 0, retries = 0, actions = 0, tokens = 0, retryKnown = false;
  history.forEach((h, i) => {
    if (String(h.status).toUpperCase() === 'FAILED') failed++;
    if (i && String(history[i - 1].status).toUpperCase() !== String(h.status).toUpperCase()) transitions++;
    const retry = retriesFor(h);
    if (retry != null) { retryKnown = true; retries += n(retry); }
    actions += n(h.stepsExecuted); tokens += n(h.pricing?.totalTokens);
  });
  return { history, runs: history.length, transitions, failed, retries, retryKnown, actions, tokens, failRate: history.length ? failed / history.length * 100 : 0, volatility: history.length > 1 ? transitions / (history.length - 1) * 100 : 0, avgActions: history.length ? actions / history.length : 0 };
}

export interface AggregateRun { key: string; label: string; timestamp: number; passed: number; retry: number; failed: number; total: number; actions: number; tokens: number; cost: number; retryCount: number; retryKnown: boolean }
export function aggregateRuns(report: Report): AggregateRun[] {
  const runs = new Map<string, AggregateRun>();
  report.testCases.forEach(t => arr(t.runHistory).forEach((h, index) => {
    const key = String(h.runId || h.timestamp || `${t.slug}-${index}`), ts = +new Date(h.timestamp);
    const r = runs.get(key) || { key, label: h.runId || h.timestamp, timestamp: Number.isFinite(ts) ? ts : 0, passed: 0, retry: 0, failed: 0, total: 0, actions: 0, tokens: 0, cost: 0, retryCount: 0, retryKnown: false };
    const retry = retriesFor(h);
    r.timestamp = Math.max(r.timestamp, Number.isFinite(ts) ? ts : 0); r.total++; r.actions += n(h.stepsExecuted);
    if (retry != null) { r.retryKnown = true; r.retryCount += retry; }
    if (String(h.status).toUpperCase() === 'FAILED') r.failed++; else if (n(retry) > 0) r.retry++; else if (String(h.status).toUpperCase() === 'PASSED') r.passed++;
    r.tokens += n(h.pricing?.totalTokens); r.cost += n(h.pricing?.estimatedCostUsd); runs.set(key, r);
  }));
  return [...runs.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/** Collapse Playwright call logs / long URLs into a stable, scannable cause label. */
export function normalizeFailureCause(text?: string | null, max = 110): string {
  let clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  clean = clean
    .replace(/Call log:[\s\S]*$/i, '')
    .replace(/https?:\/\/\S+/gi, (url) => {
      try { return new URL(url).hostname; } catch { return url.slice(0, 40); }
    })
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length > max) clean = `${clean.slice(0, max - 1).trimEnd()}…`;
  return clean;
}

export function failureCauses(report: Report) {
  const causes = new Map<string, number>(), add = (text?: string | null) => {
    const clean = normalizeFailureCause(text);
    if (clean) causes.set(clean, (causes.get(clean) || 0) + 1);
  };
  report.testCases.filter(t => String(t.status).toUpperCase() === 'FAILED').forEach(t => {
    if (t.statusReason) add(t.statusReason);
    else if (t.failureContext) add(t.failureContext);
    arr(t.evidenceTimeline).filter(e => e.error).forEach(e => add(e.failureReason || e.error));
    const findings = arr(t.rootCauseAnalysis?.findings);
    if (findings.length) findings.forEach(f => add(f.claim));
    else if (!t.statusReason && !t.failureContext) add(t.rootCauseAnalysis?.summary);
  });
  return [...causes].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)).slice(0, 4);
}

export function suiteGovernance(report: Report) {
  const tests = report.testCases.filter(hasEvidence), order = { low: 1, medium: 2, high: 3, critical: 4 };
  const worstTest = tests.filter(t => t.risk).sort((a, b) => (order[b.risk!.level] || 0) - (order[a.risk!.level] || 0) || n(b.risk!.score) - n(a.risk!.score))[0];
  const grades = tests.map(t => t.completeness?.grade).filter(Boolean).sort().reverse();
  const locators = tests.reduce((a, t) => ({ verified: a.verified + n(t.evidenceLocators?.verified), total: a.total + n(t.evidenceLocators?.total) }), { verified: 0, total: 0 });
  return { tests, worstTest, worst: worstTest?.risk, lowestGrade: grades[0] || null, locators, verifiedRatio: locators.total ? locators.verified / locators.total : null, healed: tests.reduce((sum, t) => sum + n(t.healingCount), 0) };
}

export function computeInsights(report: Report) {
  const findings = report.testCases.flatMap(t => arr(t.rootCauseAnalysis?.findings)).filter(f => Number.isFinite(Number(f.confidence)));
  const heals = report.testCases.flatMap(t => arr(t.evidenceHealing));
  let recovered = 0;
  report.testCases.forEach(t => { const h = historyStats(t).history; for (let i = 1; i < h.length; i++) if (String(h[i - 1].status).toUpperCase() === 'FAILED' && String(h[i].status).toUpperCase() === 'PASSED') recovered++; });
  return {
    confidence: findings.length ? Math.round(findings.reduce((sum, f) => sum + n(f.confidence), 0) / findings.length * 100) : null,
    preventable: report.testCases.filter(t => String(t.status).toUpperCase() === 'FAILED' && arr(t.evidenceHealing).some(h => h.classification === 'refactor')).length,
    recovered, learned: heals.filter(h => h.committed).length, diagnosed: report.testCases.filter(t => t.rootCauseAnalysis).length,
    heals: heals.length, rerun: report.testCases.filter(t => arr(t.runHistory).length > 1).length,
    generated: report.overview.generatedTests ?? report.generatedTests ?? null,
    saved: report.overview.estimatedHoursSaved ?? report.estimatedHoursSaved ?? null,
  };
}

export type RankMode = 'failed' | 'slowest' | 'tokens' | 'volatile';
export const rankedRows = (report: Report, mode: RankMode = 'failed') => report.testCases.map(test => ({ test, stats: historyStats(test) })).sort((a, b) =>
  mode === 'slowest' ? b.stats.avgActions - a.stats.avgActions : mode === 'tokens' ? b.stats.tokens - a.stats.tokens : mode === 'volatile' ? b.stats.volatility - a.stats.volatility : b.stats.failRate - a.stats.failRate);

export const delta = (current: number | null | undefined, previous: number | null | undefined, inverse = false) => {
  if (current == null || previous == null) return { value: null, tone: 'neutral' as const };
  const value = n(current) - n(previous);
  return { value, tone: value === 0 ? 'neutral' as const : ((value > 0) !== inverse ? 'up' as const : 'down' as const) };
};
export function kpiDeltas(report: Report) {
  const runs = aggregateRuns(report), latest = runs.at(-1), previous = runs.at(-2);
  const flaky = report.testCases.filter(t => historyStats(t).transitions > 0).length, priorFlaky = report.testCases.filter(t => historyStats(t, true).transitions > 0).length;
  const retry = own(report.overview, 'retryRate') ? n(report.overview.retryRate) : latest?.retryKnown ? latest.retryCount / Math.max(latest.total, 1) * 100 : null;
  const priorRetry = previous?.retryKnown ? previous.retryCount / Math.max(previous.total, 1) * 100 : null;
  return { previous, flaky, retry, pass: delta(report.overview.passRate, previous?.total ? previous.passed / previous.total * 100 : null), failed: delta(report.overview.failed, previous?.failed, true), flakyDelta: delta(flaky, priorFlaky, true), actions: delta(report.overview.totalSteps, previous?.actions), retryDelta: delta(retry, priorRetry, true), tokens: delta(report.overview.totalTokens, previous?.tokens), cost: delta(report.overview.totalCostUsd, previous?.cost) };
}
