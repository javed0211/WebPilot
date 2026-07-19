import { Terminal } from 'lucide-react';
import type { Report } from '../types';
import { Empty } from './Empty';
import { Title } from './shared';
export function Logs({ report }: { report: Report }) {
  const logs = report.testCases.flatMap(t => t.runtimeInsights.map(x => `[${x.type || 'info'}] ${t.testName}: ${x.message || ''}`));
  return <><Title eyebrow="RUNTIME OUTPUT" title="Test logs" copy="Recorded observations and diagnostic messages." />{logs.length ? <pre className="logs">{logs.join('\n')}</pre> : <Empty icon={Terminal} title="No runtime logs" copy="No diagnostic messages were recorded." />}</>;
}
