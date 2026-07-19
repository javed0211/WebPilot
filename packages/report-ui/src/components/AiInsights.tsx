import { Brain, CalendarCheck, Clock, Sparkles, GitBranch, SlidersHorizontal, CalendarClock } from 'lucide-react';
import type { Report } from '../types';
import { computeInsights } from '../lib/analytics';
import { number } from '../lib/format';

export function AiInsights({ report }: { report: Report }) {
  const x = computeInsights(report);
  const cells = [
    [CalendarCheck, 'Root-cause confidence', x.confidence == null ? '—' : `${x.confidence}%`],
    [Clock, 'Preventable failures', number(x.preventable)],
    [Sparkles, 'Recovered executions', number(x.recovered)],
    [GitBranch, 'Learned selectors', number(x.learned)],
    [SlidersHorizontal, 'Generated tests', x.generated == null ? '—' : number(x.generated)],
    [CalendarClock, 'Estimated hours saved', x.saved == null ? '—' : `${Number(x.saved).toFixed(1)}h`],
  ] as const;
  return <section className="ai-insights" aria-label="AI insights">
    <div className="ai-lead"><div className="ai-icon"><Brain /></div><div><span>AI INSIGHTS</span><strong>Execution diagnosis</strong><small>{x.heals} repairs • {x.rerun} rerun</small></div></div>
    {cells.map(([Icon, label, value]) => <div className="ai-cell" key={label}><Icon /><div><span>{label}</span><b>{value}</b></div></div>)}
  </section>;
}
