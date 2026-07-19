import { useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, Check, CircleX, Clock3, Coins, Cpu, DollarSign, Gauge, ListChecks, MousePointerClick, RotateCcw, Shuffle, Sparkles, Trophy, type LucideIcon } from 'lucide-react';
import type { Report } from '../types';
import { aggregateRuns, failureCauses, historyStats, kpiDeltas, rankedRows, type RankMode } from '../lib/analytics';
import { date, durationMs, excerpt, money, n, number, own } from '../lib/format';
import { AiInsights } from './AiInsights';
import { HealthChart } from './charts';
import { Empty } from './Empty';
import { GovernanceBand } from './GovernanceBand';
import { Status } from './Status';
import { PanelHead } from './shared';

function Delta({ data, suffix = '', digits = 0 }: { data: { value: number | null; tone: string }; suffix?: string; digits?: number }) {
  if (data.value == null) return <small className="delta neutral">— vs prior</small>;
  const sign = data.value > 0 ? '+' : data.value < 0 ? '−' : '';
  return <small className={`delta ${data.tone}`}>{sign}{Math.abs(data.value).toFixed(digits)}{suffix} vs prior</small>;
}
export function Overview({ report }: { report: Report }) {
  const o = report.overview, runs = aggregateRuns(report).slice(-6), causes = failureCauses(report), d = kpiDeltas(report), [rank, setRank] = useState<RankMode>('failed');
  const totalTime = o.totalDurationMs ?? report.totalDurationMs, allPassed = o.total > 0 && o.failed === 0;
  const volatile = rankedRows(report, 'volatile').slice(0, 3), slow = rankedRows(report, 'slowest').slice(0, 3), tokens = rankedRows(report, 'tokens').slice(0, 3);
  const briefingSource = report.suiteAiAnalysis || report.testCases.find(t => t.aiAnalysis)?.aiAnalysis;
  const briefing = excerpt(briefingSource, 220);
  const briefingTruncated = Boolean(briefingSource && excerpt(briefingSource, Number.MAX_SAFE_INTEGER).length > 220);
  const kpis = [
    ['Pass rate', `${n(o.passRate).toFixed(2)}%`, d.pass, ' pts', Gauge], ['Failed', number(o.failed), d.failed, '', CircleX], ['Flaky', number(d.flaky), d.flakyDelta, '', Shuffle],
    ['Actions', number(o.totalSteps), d.actions, '', MousePointerClick], ['Retry', d.retry == null ? '—' : `${Math.round(d.retry)}%`, d.retryDelta, ' pts', RotateCcw],
    ['Tokens', number(o.totalTokens), d.tokens, '', Cpu], ['Cost', money(o.totalCostUsd), d.cost, '', DollarSign],
  ] as const;
  return <><section className="hero"><div><span className="eyebrow">SUITE EXECUTION REPORT</span><h1>{report.suiteName || 'Untitled test suite'}</h1><div className="hero-meta"><span className="chip">{report.environment.name}</span><span>{date(report.generatedAt)}</span></div></div><div className="verdict"><small>RUN VERDICT</small><strong className={allPassed ? 'pass' : 'fail'}>{allPassed ? 'PASSED' : 'ACTION REQUIRED'}</strong></div></section>
    <section className="execution-strip"><div><label>Executed</label><b>{number(o.executed ?? o.total)}</b></div><div><label>Passed</label><b>{number(o.passed)}</b></div><div><label>Failed</label><b>{number(o.failed)}</b></div><div><label>Skipped</label><b>{own(o, 'skipped') ? number(o.skipped) : '—'}</b></div><div><label>Cancelled</label><b>{own(o, 'cancelled') ? number(o.cancelled) : '—'}</b></div><div><label>Total time</label><b>{durationMs(totalTime)}</b></div><div className="execution-context"><label>Runtime</label><b>{report.environment.name} · {report.browser.target} · {report.browser.headless ? 'headless' : 'headed'}</b></div></section>
    <section className="kpis seven">{kpis.map(([label, value, delta, suffix, Icon], i) => <article className="kpi" key={label}><Icon /><label>{label}</label><b>{value}</b><Delta data={delta} suffix={suffix} digits={i === 6 ? 3 : 0} /></article>)}</section>
    <GovernanceBand report={report} />
    {briefing && <section className="panel ai-brief"><Sparkles /><div><span className="eyebrow">AI BRIEFING</span><p>{briefing}{briefingTruncated ? '…' : ''}</p></div><a href="#ai-analysis">Read full briefing <ArrowRight /></a></section>}
    <div className="analytics-grid"><section className="panel chart-panel"><PanelHead icon={Activity} title="Execution health trend" copy="Recent pass / retry / fail snapshots" action="#trends" />{runs.length ? <HealthChart runs={runs} compact /> : <Empty title="No execution snapshots" copy="Run history is required for the health trend." />}</section>
      <section className="panel"><PanelHead icon={AlertTriangle} title="Top failure causes" copy="Grouped from evidence and grounded findings" />{causes.length ? <div className="cause-list">{causes.map(c => <div key={c.text}><span title={c.text}>{c.text}</span><b>{c.count}</b></div>)}</div> : <Empty icon={Check} title="No failure causes" copy="No failed evidence was recorded." />}</section></div>
    <div className="tri-grid"><Mini title="Flaky analysis" copy="Status volatility" icon={RotateCcw} rows={volatile.map(x => [x.test.testName, x.stats.runs > 1 ? `${Math.round(x.stats.volatility)}%` : '—', x.stats.volatility])} /><Mini title="Slowest tests" copy="Average action count" icon={Clock3} rows={slow.map(x => [x.test.testName, `${x.stats.avgActions.toFixed(1)} avg`, x.stats.avgActions])} /><Mini title="Token consumption" copy="Historical usage" icon={Coins} rows={tokens.map(x => [x.test.testName, number(x.stats.tokens), x.stats.tokens])} /></div>
    <AiInsights report={report} />
    <section className="ranked panel"><div className="rank-tabs" role="tablist"><span className="panel-ico"><Trophy /></span>{([['failed', 'Most Failed'], ['slowest', 'Slowest'], ['tokens', 'Top Tokens']] as const).map(([id, label]) => <button role="tab" aria-selected={rank === id} className={rank === id ? 'active' : ''} onClick={() => setRank(id)} key={id}>{label}</button>)}</div><div className="table-wrap"><table><thead><tr><th>Test</th><th>Runs</th><th>Fail %</th><th>Retry</th><th>Avg actions</th><th>Tokens</th></tr></thead><tbody>{rankedRows(report, rank).map(({ test, stats }) => <tr key={test.slug}><td><a href={`#test-${test.slug}`}><strong>{test.testName}</strong></a></td><td>{stats.runs}</td><td>{stats.runs ? `${Math.round(stats.failRate)}%` : '—'}</td><td>{stats.retryKnown && stats.runs ? `${Math.round(stats.retries / stats.runs * 100)}%` : '—'}</td><td>{stats.runs ? stats.avgActions.toFixed(1) : '—'}</td><td>{stats.runs ? number(stats.tokens) : '—'}</td></tr>)}</tbody></table></div></section>
    <PanelHead icon={ListChecks} title="Test results" copy={`${report.testCases.length} recorded test cases`} /><div className="table-wrap"><table><thead><tr><th>Status</th><th>Test case</th><th>Steps</th><th>Risk</th><th>Grade</th><th>Verified</th><th>Cost</th><th /></tr></thead><tbody>{report.testCases.map(t => <tr key={t.slug}><td><Status value={t.status} /></td><td><strong>{t.testName}</strong><small>{date(t.timestamp)}{t.kind === 'api' ? ' · API' : ''}{t.executionMode ? ` · ${t.executionMode}` : ''}{t.aiAnalysis ? ` · ${excerpt(t.aiAnalysis, 70)}` : ''}</small></td><td>{t.stepsExecuted}</td><td>{t.risk ? <span className={`risk ${t.risk.level}`}>{t.risk.score} · {t.risk.level}</span> : '—'}</td><td>{t.completeness ? <span className="grade">{t.completeness.grade}</span> : '—'}</td><td>{t.evidenceLocators && t.evidenceLocators.verifiedRatio != null ? <div className="meter" title={`${Math.round(t.evidenceLocators.verifiedRatio * 100)}% verified`}><i style={{ width: `${t.evidenceLocators.verifiedRatio * 100}%` }} /></div> : '—'}</td><td>{money(t.pricing?.estimatedCostUsd)}</td><td><a href={`#test-cases?test=${encodeURIComponent(t.slug)}`} aria-label={`Open ${t.testName}`}><ArrowRight /></a></td></tr>)}</tbody></table></div>
  </>;
}
function Mini({ title, copy, icon: Icon, rows }: { title: string; copy: string; icon: LucideIcon; rows: [string, string, number][] }) {
  const max = Math.max(...rows.map(r => r[2]), 1);
  return <section className="mini-analytic"><header><Icon /><div><h3>{title}</h3><p>{copy}</p></div></header>{rows.map(([name, value, bar]) => <div className="rank-item" key={name}><div><span>{name}</span><b>{value}</b></div><i><em style={{ width: `${Math.max(3, bar / max * 100)}%` }} /></i></div>)}</section>;
}
