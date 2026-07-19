import { useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Copy, FileStack, Filter, MousePointerClick, ShieldCheck, SlidersHorizontal, XCircle } from 'lucide-react';
import type { EvidenceTimelineStep, TestCase } from '../types';
import { durationMs } from '../lib/format';
import { Empty } from './Empty';

type FilterId = 'all' | 'verified' | 'actions' | 'assertions' | 'warnings';

const isApiTest = (test: TestCase) => String(test.kind || '').toLowerCase() === 'api' || String(test.executionMode || '').toLowerCase() === 'api';
const isApiStep = (e: EvidenceTimelineStep) => !!e.httpMethod || ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes((e.action || '').toLowerCase());
const isAssert = (e: EvidenceTimelineStep) => !!e.assertion || e.action === 'assert';
const isFailed = (e: EvidenceTimelineStep) => !!e.error || e.outcome === 'FAILED';
const isWarning = (e: EvidenceTimelineStep) => !isFailed(e) && (e.healed || e.locator?.verified === false);
const isVerified = (e: EvidenceTimelineStep) => !isFailed(e) && !isWarning(e);
const evidenceItems = (e: EvidenceTimelineStep) => [e.locator, e.assertion, e.url, e.screenshotPath, e.error, e.responsePreview, e.httpStatus].filter(Boolean).length;

const statusLine = (e: EvidenceTimelineStep): string => {
  if (isFailed(e)) return e.failureReason || (isApiStep(e) ? `HTTP ${e.httpStatus ?? '—'}` : 'Step failed');
  if (isApiStep(e)) return e.httpStatus != null ? `HTTP ${e.httpStatus}` : 'Request completed';
  if (isAssert(e)) return 'Assertion passed';
  return ({ navigate: 'Page loaded', click: 'Click completed', input: 'Input set', scroll: 'Scroll completed' } as Record<string, string>)[e.action] || 'Completed';
};
const badgeOf = (e: EvidenceTimelineStep) => isApiStep(e) ? (e.httpMethod || e.action || 'request').toLowerCase() : isAssert(e) ? 'assert' : (e.action || 'step').toLowerCase();

export function EvidenceTimeline({ test }: { test: TestCase }) {
  const steps = test.evidenceTimeline || [];
  const api = isApiTest(test) || steps.some(isApiStep);
  const [filter, setFilter] = useState<FilterId>('all');
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const counts = useMemo(() => ({
    all: steps.length,
    verified: steps.filter(isVerified).length,
    actions: steps.filter(e => !isAssert(e)).length,
    assertions: steps.filter(isAssert).length,
    warnings: steps.filter(e => isWarning(e) || isFailed(e)).length,
    evidence: steps.reduce((sum, e) => sum + evidenceItems(e), 0),
  }), [steps]);
  if (!steps.length) return <Empty title="No evidence timeline" copy={api ? 'API step evidence was not captured for this run.' : 'Step-level evidence was not captured.'} />;

  const match = (e: EvidenceTimelineStep): boolean =>
    filter === 'verified' ? isVerified(e)
      : filter === 'actions' ? !isAssert(e)
        : filter === 'assertions' ? isAssert(e)
          : filter === 'warnings' ? isWarning(e) || isFailed(e)
            : true;
  const visible = steps.filter(match);
  const failed = steps.filter(isFailed).length;
  const ratio = steps.length ? Math.round((counts.verified / steps.length) * 100) : 0;
  const filterDefs: [FilterId, string, number][] = [['all', 'All', counts.all], ['verified', 'Verified', counts.verified], ['actions', api ? 'Requests' : 'Actions', counts.actions], ['assertions', 'Assertions', counts.assertions], ['warnings', 'Warnings', counts.warnings]];
  const stats: [typeof CheckCircle2, string, number, string][] = [
    [CheckCircle2, 'ok', counts.verified, api ? 'Passed requests' : 'Verified steps'],
    [MousePointerClick, 'act', counts.actions, api ? 'Request steps' : 'Action steps'],
    [ShieldCheck, 'assert', counts.assertions, 'Assertions'],
    [AlertTriangle, 'warn', counts.warnings, 'Warnings'],
    [FileStack, 'items', counts.evidence, 'Evidence items'],
  ];

  return <section className="tl-panel">
    <header className="tl-head">
      <div className="tl-title"><SlidersHorizontal /><h2>{api ? 'API evidence timeline' : 'Evidence timeline'}</h2></div>
      <div className="tl-filters" role="group" aria-label="Filter timeline steps">
        {filterDefs.map(([id, label, count]) => <button type="button" key={id} className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<b>{count}</b></button>)}
      </div>
    </header>
    <div className="tl-stats">
      {stats.map(([Icon, tone, value, label]) => <div className={`tl-stat ${tone}`} key={label}><span className="tl-stat-ico"><Icon /></span><div><b>{value}</b><small>{label}</small></div></div>)}
      <span className="tl-funnel" aria-hidden="true"><Filter /></span>
    </div>
    <ol className="tl-list">
      {visible.map(e => <TimelineRow key={e.index} step={e} open={!!open[e.index]} onToggle={() => setOpen(prev => ({ ...prev, [e.index]: !prev[e.index] }))} />)}
      {!visible.length && <li className="tl-none">No steps match this filter.</li>}
    </ol>
    <footer className={`tl-outcome ${failed ? 'bad' : 'good'}`}>
      {failed ? <XCircle /> : <CheckCircle2 />}
      <p>{failed
        ? `${failed} of ${steps.length} step${steps.length === 1 ? '' : 's'} failed — review the highlighted steps above.`
        : api
          ? `All ${steps.length} API steps completed successfully.`
          : `All ${steps.length} steps completed successfully with ${ratio}% verification.`}</p>
    </footer>
  </section>;
}

function TimelineRow({ step: e, open, onToggle }: { step: EvidenceTimelineStep; open: boolean; onToggle: () => void }) {
  const failed = isFailed(e), warning = isWarning(e), api = isApiStep(e);
  const locatorText = e.locator ? (e.locator.used || e.locator.value || e.locator.name || e.locator.kind || '') : '';
  return <li className={`tl-row ${failed ? 'failed' : warning ? 'warn' : ''}`}>
    <span className="tl-node" aria-hidden="true">{failed ? <XCircle /> : warning ? <AlertTriangle /> : <CheckCircle2 />}<i /></span>
    <div className="tl-body" onClick={onToggle}>
      <div className="tl-main">
        <div className="tl-main-top"><span className="tl-num">{e.index}</span><b className={`tl-badge ${badgeOf(e)}`}>{badgeOf(e)}</b>{e.healed && <b className="tl-badge healed">healed</b>}</div>
        <strong>{e.nlStep || e.action}</strong>
        {e.url ? <small className="mono">{e.url}</small> : e.pageTitle ? <small><em>Context</em>{e.pageTitle}</small> : null}
        {failed && e.failureReason ? <small className="tl-why">{e.failureReason}</small> : null}
      </div>
      <div className="tl-verify">
        <span className={failed ? 'bad' : warning ? 'mid' : 'ok'}>{failed ? <XCircle /> : <Check />}{failed ? 'Failed' : warning ? 'Unverified' : api ? 'Passed' : 'Verified'}</span>
        <small className={failed ? 'bad' : ''}>{statusLine(e)}</small>
      </div>
      <div className="tl-meta">
        {api ? <>
          <label>{e.expectedStatus != null ? 'Status' : 'HTTP'}</label>
          <span className="tl-plain">{e.httpStatus ?? '—'}{e.expectedStatus != null ? ` / expected ${e.expectedStatus}` : ''}</span>
        </> : e.locator ? <>
          <label>{failed && e.attemptedLocators?.length ? 'Attempted' : 'Locator'}</label>
          <span className="tl-code"><code>{failed && e.attemptedLocators?.[0] ? e.attemptedLocators[0] : locatorText}</code><CopyBtn text={failed && e.attemptedLocators?.[0] ? e.attemptedLocators[0] : locatorText} /></span>
        </> : e.pageTitle ? <>
          <label>Page title</label>
          <span className="tl-plain">{e.pageTitle}</span>
        </> : e.action === 'navigate' ? <>
          <label>Page loaded</label>
          <span className="tl-dot" aria-hidden="true" />
        </> : null}
      </div>
      <button type="button" className="tl-chev-btn" aria-expanded={open} aria-label={`Step ${e.index} details`} onClick={ev => { ev.stopPropagation(); onToggle(); }}><ChevronDown className={`tl-chev ${open ? 'open' : ''}`} /></button>
    </div>
    {open && <TimelineDetail step={e} />}
  </li>;
}

function TimelineDetail({ step: e }: { step: EvidenceTimelineStep }) {
  const rows: [string, string][] = [];
  if (e.httpMethod) rows.push(['Method', e.httpMethod.toUpperCase()]);
  if (e.url) rows.push([e.httpMethod ? 'Request URL' : 'URL', e.url]);
  if (e.httpStatus != null) rows.push(['Actual status', String(e.httpStatus)]);
  if (e.expectedStatus != null) rows.push(['Expected status', String(e.expectedStatus)]);
  if (e.after?.url && e.after.url !== e.url) rows.push(['URL after step', e.after.url]);
  if (e.pageTitle) rows.push(['Page title', e.pageTitle]);
  if (e.control?.accessibleName) rows.push(['Control', `${e.control.accessibleName}${e.control.tag ? ` <${e.control.tag}>` : ''}`]);
  if (e.locator?.planned) rows.push(['Planned locator', e.locator.planned]);
  if (e.attemptedLocators?.length) rows.push(['Attempted locators', e.attemptedLocators.join(' | ')]);
  if (e.locator && !e.httpMethod) {
    if (e.locator.used && e.locator.used !== e.locator.planned) rows.push(['Resolved locator', e.locator.used]);
    rows.push(['Locator proof', e.locator.verified ? `Verified by ${e.locator.verifiedBy || 'snapshot'}${e.locator.matchCount != null ? ` · ${e.locator.matchCount} match${e.locator.matchCount === 1 ? '' : 'es'}` : ''} (planned candidate)` : 'Unverified']);
  }
  if (e.assertion?.kind) rows.push(['Assertion', `${e.assertion.kind}${e.assertion.expected ? ` · expected ${e.assertion.expected}` : ''}${e.assertion.actual ? ` · actual ${e.assertion.actual}` : ''}${e.assertion.strength ? ` · ${e.assertion.strength}` : ''}`]);
  if (e.durationMs != null) rows.push(['Duration', durationMs(e.durationMs)]);
  if (e.responsePreview) rows.push(['Response preview', e.responsePreview.slice(0, 500)]);
  if (e.after?.inventoryChanged) rows.push(['Page inventory', 'Changed after this step']);
  if (e.failureReason) rows.push(['Why it failed', e.failureReason]);
  if (e.error && e.error !== e.failureReason) rows.push(['Error detail', e.error]);
  return <dl className="tl-detail">{rows.map(([k, v]) => <div key={k} className={k === 'Error detail' || k === 'Why it failed' ? 'bad' : ''}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="tl-copy" aria-label="Copy locator"
    onClick={ev => { ev.stopPropagation(); navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); }}>
    {done ? <Check /> : <Copy />}
  </button>;
}
