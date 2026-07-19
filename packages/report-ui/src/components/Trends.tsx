import { Activity, Coins, Layers } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Report } from '../types';
import { aggregateRuns, historyStats, type AggregateRun } from '../lib/analytics';
import { date, money, number, shortDate, statusClass } from '../lib/format';
import { Chart, HealthChart } from './charts';
import { Empty } from './Empty';
import { PanelHead, Title } from './shared';

interface TooltipEntry {
  color?: string;
  dataKey?: string | number;
  name?: string;
  value?: string | number;
  payload?: AggregateRun;
}

function RunTooltip({ active, payload }: { active?: boolean; payload?: readonly TooltipEntry[] }) {
  const run = payload?.[0]?.payload;
  if (!active || !run || !payload?.length) return null;

  return <div className="chart-tooltip">
    <strong>{date(run.timestamp)}</strong>
    <span>{run.label}</span>
    <dl>{payload.map((entry) => <div key={String(entry.dataKey)}>
      <dt><i style={{ background: entry.color }} />{entry.name}</dt>
      <dd>{entry.dataKey === 'cost' ? money(entry.value) : number(entry.value)}</dd>
    </div>)}</dl>
  </div>;
}

const axisTick = { fill: 'var(--muted)', fontSize: 10 };
const tooltip = <RunTooltip />;

export function Trends({ report }: { report: Report }) {
  const runs = aggregateRuns(report);
  return <><Title eyebrow="EXECUTION ANALYTICS" title="Trends" copy={`Health, usage and stability across ${runs.length} recorded suite runs.`} />{!runs.length ? <Empty title="No historical runs" copy="Trend analytics appear after tests include runHistory records." /> : <>
    <div className="analytics-grid"><section className="panel chart-panel"><PanelHead icon={Activity} title="Execution health" copy="Pass / retry / fail composition" />
      <HealthChart runs={runs} />
    </section>
      <section className="panel chart-panel"><PanelHead icon={Coins} title="Token & cost trend" copy="Historical model usage" />
        <Chart label={`Composed chart of token usage and estimated cost across ${runs.length} runs`}>{({ width, height }) =>
          <ComposedChart width={width} height={height} data={runs} margin={{ top: 8, right: 0, bottom: 2, left: -8 }} accessibilityLayer>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="timestamp" tickFormatter={shortDate} tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={16} />
            <YAxis yAxisId="tokens" tickFormatter={(value) => number(value)} tick={axisTick} tickLine={false} axisLine={false} width={48} />
            <YAxis yAxisId="cost" orientation="right" tickFormatter={(value) => money(value)} tick={axisTick} tickLine={false} axisLine={false} width={56} />
            <Tooltip content={tooltip} cursor={{ stroke: 'var(--blue)', strokeOpacity: .35 }} />
            <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 10, color: 'var(--muted)' }} />
            <Bar yAxisId="tokens" dataKey="tokens" name="Tokens" fill="var(--blue)" fillOpacity={.82} maxBarSize={30} />
            <Line yAxisId="cost" dataKey="cost" name="Estimated cost" type="monotone" stroke="var(--violet)" strokeWidth={2} dot={{ r: 3, fill: 'var(--surface)', strokeWidth: 2 }} activeDot={{ r: 4 }} />
          </ComposedChart>}
        </Chart>
      </section></div>
    <section className="panel"><PanelHead icon={Layers} title="Per-test stability" copy="Oldest to newest recorded status" /><div className="stability">{report.testCases.map(t => { const h = historyStats(t).history; return <div className="stability-row" key={t.slug}><div><strong>{t.testName}</strong><small>{h.length} runs</small></div><div>{h.length ? h.map((x, i) => <i key={`${x.runId}-${i}`} className={statusClass(x.status)} title={`${x.timestamp} · ${x.status}`} />) : <span> No history</span>}</div></div>; })}</div></section>
  </>}</>;
}
