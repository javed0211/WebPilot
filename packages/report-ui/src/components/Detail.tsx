import { Archive, Coins, Crosshair, ExternalLink, FileText, GitCompareArrows, History, ListChecks, Target, Wrench, type LucideIcon } from 'lucide-react';
import type { TestCase } from '../types';
import { cap, date, evidenceHref, isImagePath, isVideoPath, money, n, number, safePath } from '../lib/format';
import { hasEvidence } from '../lib/analytics';
import { Markdown } from '../lib/markdown';
import { Empty } from './Empty';
import { EvidenceTimeline } from './EvidenceTimeline';
import { RiskDial } from './RiskDial';
import { Status } from './Status';
import { AiGlyph } from './shared';

const isApi = (test: TestCase) => String(test.kind || '').toLowerCase() === 'api' || String(test.executionMode || '').toLowerCase() === 'api';

const webTabs: [string, string, LucideIcon | typeof AiGlyph][] = [['timeline', 'Evidence timeline', ListChecks], ['locators', 'Locators', Crosshair], ['healing', 'Heal ledger', Wrench], ['drift', 'Page drift', GitCompareArrows], ['root', 'Root cause', Target], ['analysis', 'AI analysis', AiGlyph], ['artifacts', 'Artifacts', Archive], ['history', 'Run history', History], ['cost', 'LLM cost', Coins]];
const apiTabs: [string, string, LucideIcon | typeof AiGlyph][] = [['timeline', 'Request timeline', ListChecks], ['root', 'Root cause', Target], ['analysis', 'AI analysis', AiGlyph], ['artifacts', 'Artifacts', Archive], ['history', 'Run history', History], ['cost', 'LLM cost', Coins]];

export function Detail({ test, tab, onTab, showBack = true }: { test: TestCase; tab: string; onTab: (tab: string) => void; showBack?: boolean }) {
  const api = isApi(test);
  const tabs = api ? apiTabs : webTabs;
  const activeTab = tabs.some(([id]) => id === tab) ? tab : 'timeline';
  const modeLabel = test.executionMode ? cap(test.executionMode) : api ? 'API' : null;
  return <>
    {showBack && <a className="back" href="#overview">← Back to overview</a>}
    <section className="detail-head">
      <div>
        <div className="event-top"><Status value={test.status} /><span>{date(test.timestamp)}</span>{modeLabel && <span className="chip">{modeLabel}</span>}{api && <span className="chip">API</span>}</div>
        <h1>{test.testName}</h1>
        <p>{test.stepsExecuted} {api ? 'requests' : 'steps'} · {money(test.pricing?.estimatedCostUsd)} estimated cost</p>
        {test.statusReason && String(test.status).toUpperCase() === 'FAILED' && <p className="status-reason">{test.statusReason}</p>}
      </div>
      {test.evidenceRef && <a className="evidence-link" href={evidenceHref(test.evidenceRef)}>Open Evidence JSON <ExternalLink /></a>}
    </section>
    <EvidenceGovernance test={test} />
    <div className="tabs" role="tablist" aria-label="Test detail sections">{tabs.map(([id, label, Icon]) => <button type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? 'active' : ''} onClick={() => onTab(id)} key={id}><Icon />{label}</button>)}</div>
    <DetailTab test={test} tab={activeTab} />
  </>;
}

function EvidenceGovernance({ test }: { test: TestCase }) {
  if (!hasEvidence(test)) return <Empty title="Evidence not available" copy="This run predates evidence and governance capture." />;
  const api = isApi(test);
  const r = test.risk, c = test.completeness, l = test.evidenceLocators;
  const timeline = test.evidenceTimeline || [];
  const apiPassed = timeline.filter(s => !s.error && s.outcome !== 'FAILED').length;
  const apiFailed = timeline.filter(s => s.error || s.outcome === 'FAILED').length;
  const ratio = l?.verifiedRatio;
  return <section className="gov-panel">
    <div className="gov-panel-top">
      <div className="risk-block">{r && <RiskDial score={r.score} level={r.level} size={104} />}<div className="factor-list"><span className="eyebrow">RISK FACTORS</span><div className="factors">{r?.factors?.length ? r.factors.map(f => <div className="factor" key={f.id}><div><span>{cap(f.id)}</span><b>+{f.weight}</b></div><i><em style={{ width: `${Math.min(100, f.weight * 2.5)}%` }} /></i><small>{f.detail}</small></div>) : <p>No factors recorded.</p>}</div></div></div>
      <div className="grade-block"><span className="eyebrow">COMPLETENESS</span><b>{c?.grade || '—'}</b><p>{n(c?.score)} / 100 evidence score</p>{c?.warnings?.map(x => <small key={x}>{x}</small>)}</div>
      {api ? (
        <div className="verify-block"><span className="eyebrow">REQUEST PROOF</span><b>{timeline.length ? `${Math.round(apiPassed / Math.max(timeline.length, 1) * 100)}%` : '—'}</b><i><em style={{ width: `${timeline.length ? apiPassed / timeline.length * 100 : 0}%` }} /></i><p>{apiPassed} passed · {apiFailed} failed</p></div>
      ) : (
        <div className="verify-block"><span className="eyebrow">LOCATOR PROOF</span><b>{ratio == null ? '—' : `${Math.round(ratio * 100)}%`}</b><i><em style={{ width: `${(ratio || 0) * 100}%` }} /></i><p>{n(l?.verified)} verified · {n(l?.unverified)} unverified</p></div>
      )}
    </div>
    <div className="gov-strip">
      {api ? <>
        <div><label>FAILED REQUESTS</label><b>{apiFailed}</b></div>
        <div><label>EXECUTION MODE</label><b>{cap(test.executionMode || 'api')}</b></div>
        <div><label>EVIDENCE STATUS</label><b>{cap(test.rootCauseAnalysis?.status || 'captured')}</b></div>
      </> : <>
        <div><label>HEALED SELECTORS</label><b>{n(test.healingCount)}</b></div>
        <div><label>CODEGEN QUALITY</label><b>{cap(test.codegenQuality)}</b></div>
        <div><label>EVIDENCE STATUS</label><b>{cap(test.rootCauseAnalysis?.status || 'captured')}</b></div>
      </>}
    </div>
  </section>;
}

function DetailTab({ test, tab }: { test: TestCase; tab: string }) {
  const api = isApi(test);
  if (tab === 'timeline') return <EvidenceTimeline test={test} />;
  if (tab === 'locators') {
    if (api) return <Empty title="Locators not applicable" copy="API tests validate HTTP requests, not page locators." />;
    const rows = (test.evidenceTimeline || []).filter((e) => e.locator);
    return rows.length ? (
      <Table
        headers={['Step', 'Type', 'Locator', 'Status', 'Proof']}
        rows={rows.map((e) => {
          const loc = e.locator!;
          const type = (loc.kind || (loc.used?.startsWith('getBy') ? 'role' : 'css') || '—').toString();
          const value =
            loc.used ||
            (loc.kind === 'role'
              ? `getByRole('${loc.value}'${loc.name ? `, { name: '${loc.name}' }` : ''})`
              : loc.value || loc.name || '—');
          return [
            e.index,
            type,
            value,
            loc.verified ? 'Verified' : 'Unverified',
            loc.verifiedBy ? `${loc.verifiedBy} · ${n(loc.matchCount)} match` : 'No proof',
          ];
        })}
      />
    ) : (
      <Empty title="No locator records" copy="Locator verification was not captured." />
    );
  }
  if (tab === 'healing') return api ? <Empty title="Healing not applicable" copy="Selector healing applies to browser runs only." /> : test.evidenceHealing?.length ? <Table headers={['Step', 'Broken selector', 'Healed selector', 'Confidence', 'Classification', 'Committed']} rows={test.evidenceHealing.map(x => [x.stepIndex, x.brokenSelector, x.healedSelector, `${Math.round(n(x.confidence) * 100)}%`, x.classification, x.committed ? 'Yes' : 'No'])} /> : <Empty title="No selector healing" copy="The run used recorded locators without repair." />;
  if (tab === 'drift') return api ? <Empty title="Page drift not applicable" copy="Page inventory drift applies to browser runs only." /> : test.evidenceDrift?.length ? <Table headers={['Page', 'Previous fingerprint', 'Current fingerprint', 'Added', 'Removed', 'Changed']} rows={test.evidenceDrift.map(x => [x.pageKey, x.previousFingerprint, x.currentFingerprint, x.added, x.removed, x.changed])} /> : <Empty title="No page drift recorded" copy="No fingerprint changes were attached." />;
  if (tab === 'root') {
    const r = test.rootCauseAnalysis;
    if (r) return <section className="panel root"><span className="chip">{r.status}</span><p>{r.summary}</p>{r.findings.map((f, i) => { const ids = f.causeEventIds || f.citedEventIds || []; return <div className={`finding ${ids.length ? '' : 'uncited'}`} key={f.findingId || i}><strong>{f.claim}</strong><div>{ids.length ? ids.map(id => <span className="cite" key={id}>{id}</span>) : <span className="mini-chip">UNCITED</span>} <small>{Math.round(n(f.confidence) * 100)}% confidence</small></div></div>; })}{r.missingEvidence?.length ? <ul>{r.missingEvidence.map(x => <li key={x}>{x}</li>)}</ul> : null}</section>;
    if (test.statusReason || test.failureContext) {
      return <section className="panel root"><span className="chip">status-reason</span><p>{test.statusReason || test.failureContext}</p></section>;
    }
    return <Empty title="No root-cause analysis" copy="A grounded analysis was not produced." />;
  }
  if (tab === 'analysis') return test.aiAnalysis ? <section className="panel analysis"><Markdown value={test.aiAnalysis} /></section> : <Empty title="No AI analysis" copy="This test has no generated analysis." />;
  if (tab === 'artifacts') {
    const shots = test.artifacts?.screenshots || [];
    const video = test.artifacts?.video;
    const trace = test.artifacts?.trace;
    if (api && !shots.length && !video && !trace) return <Empty title="No browser artifacts" copy="API runs capture request evidence in the timeline rather than video or screenshots." />;
    if (!shots.length && !video && !trace) return <Empty title="No artifacts" copy="No media or traces were attached." />;
    return <div className="artifact-grid">
      {video && <div className="artifact media" key="video">
        <video controls preload="metadata" src={safePath(video)}>
          <track kind="captions" />
          Video unavailable.
        </video>
        <span>{video.split('/').pop()}{test.executionMode === 'act-history-replay' ? ' · ActHistory evidence replay' : ''}</span>
      </div>}
      {shots.map((src) => {
        const href = safePath(src);
        return isImagePath(src)
          ? <div className="artifact media" key={src}><img src={href} alt="Execution screenshot" loading="lazy" /><span>{src.split('/').pop()}</span></div>
          : <a className="artifact" href={href} key={src}><FileText /><div><strong>{src.split('/').pop()}</strong><span>{src}</span></div><ExternalLink /></a>;
      })}
      {trace && <a className="artifact" href={safePath(trace)} key={trace}><FileText /><div><strong>{trace.split('/').pop()}</strong><span>Playwright trace</span></div><ExternalLink /></a>}
    </div>;
  }
  if (tab === 'history') return test.runHistory?.length ? <Table headers={['Run', 'Timestamp', 'Status', 'Mode', 'Steps', 'Tokens', 'Cost']} rows={test.runHistory.map(x => [x.runId, date(x.timestamp), x.status, x.executionMode, x.stepsExecuted, number(x.pricing?.totalTokens), money(x.pricing?.estimatedCostUsd)])} /> : <Empty title="No run history" copy="Prior executions are not available." />;
  const p = test.pricing; return <section className="panel cost-grid">{[['Total tokens', number(p?.totalTokens)], ['Prompt', number(p?.promptTokens)], ['Completion', number(p?.completionTokens)], ['LLM calls', number(p?.llmCalls)], ['Estimated cost', money(p?.estimatedCostUsd)]].map(([k, v]) => <div key={k}><label>{k}</label><b>{v}</b></div>)}<p>{p?.provider || 'Unknown provider'} · {p?.model || 'Unknown model'}</p></section>;
}
function Table({ headers, rows }: { headers: string[]; rows: unknown[][] }) { return <div className="table-wrap"><table><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j}>{v == null || v === '' ? '—' : String(v)}</td>)}</tr>)}</tbody></table></div>; }
