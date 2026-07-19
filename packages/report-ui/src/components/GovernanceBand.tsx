import type { Report } from '../types';
import { suiteGovernance } from '../lib/analytics';
import { cap, n } from '../lib/format';
import { RiskDial } from './RiskDial';

export function GovernanceBand({ report }: { report: Report }) {
  const g = suiteGovernance(report);
  if (!g.tests.length) return null;
  const factors = g.worst?.factors || [], total = factors.reduce((sum, f) => sum + n(f.weight), 0);
  return <section className={`governance ${g.worst?.level || 'low'}`} aria-label="Governance summary">
    <div className="gov-main">{g.worst && <RiskDial score={g.worst.score} level={g.worst.level} />}<div><span className="eyebrow">Evidence governance · worst-case risk</span><h2>{g.worstTest?.testName || 'No risk scores recorded'}</h2>
      {factors.length ? <><div className="stack-bar">{factors.map((f, i) => <i key={f.id} style={{ width: `${total ? f.weight / total * 100 : 0}%`, opacity: Math.max(.34, 1 - i * .18) }} title={`${f.id} +${f.weight}`} />)}</div><div className="stack-legend">{factors.map(f => <span key={f.id}>{cap(f.id)} <b>+{f.weight}</b></span>)}</div></> : <p>No weighted risk factors recorded.</p>}</div></div>
    <div className="gov-metrics"><div><label>LOWEST GRADE</label><b>{g.lowestGrade || '—'}</b><small>Evidence completeness</small></div><div><label>VERIFIED</label><b>{g.verifiedRatio == null ? '—' : `${Math.round(g.verifiedRatio * 100)}%`}</b><small>{g.locators.verified} of {g.locators.total} locators</small></div><div><label>HEALED</label><b>{g.healed}</b><small>Across this suite</small></div></div>
  </section>;
}
