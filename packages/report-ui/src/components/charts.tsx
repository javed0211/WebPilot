import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AggregateRun } from '../lib/analytics';
import { date, number, shortDate } from '../lib/format';

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
      <dd>{number(entry.value)}</dd>
    </div>)}</dl>
  </div>;
}

const axisTick = { fill: 'var(--muted)', fontSize: 10 };
const tooltip = <RunTooltip />;

/**
 * Measures its own box and renders the chart at explicit pixel dimensions.
 * Recharts' ResponsiveContainer can latch onto a zero size when it mounts
 * during a route switch; measuring with a ResizeObserver avoids that.
 */
export function Chart({ label, children }: { label: string; children: (size: { width: number; height: number }) => ReactElement }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div className="report-chart" ref={ref} role="img" aria-label={label}>{size.width > 0 && size.height > 0 ? children(size) : null}</div>;
}

export function HealthChart({ runs, compact = false }: { runs: AggregateRun[]; compact?: boolean }) {
  return <Chart label={`Stacked bar chart of passed, retried, and failed tests across ${runs.length} runs`}>{({ width, height }) =>
    <BarChart width={width} height={height} data={runs} margin={{ top: 8, right: 8, bottom: 2, left: -12 }} accessibilityLayer>
      <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="timestamp" tickFormatter={shortDate} tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={16} />
      <YAxis allowDecimals={false} domain={[0, (max: number) => Math.max(1, max)]} tick={axisTick} tickLine={false} axisLine={false} width={36} />
      <Tooltip content={tooltip} cursor={{ fill: 'var(--surface-2)' }} />
      {!compact && <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 10, color: 'var(--muted)' }} />}
      <Bar dataKey="passed" name="Passed" stackId="health" fill="var(--green)" maxBarSize={38} />
      <Bar dataKey="retry" name="Retried" stackId="health" fill="var(--amber)" maxBarSize={38} />
      <Bar dataKey="failed" name="Failed" stackId="health" fill="var(--red)" maxBarSize={38} />
    </BarChart>}
  </Chart>;
}
