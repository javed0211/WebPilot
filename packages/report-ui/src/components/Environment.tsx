import { Globe, MonitorSmartphone, Package, type LucideIcon } from 'lucide-react';
import type { Report } from '../types';
import { date } from '../lib/format';
import { Title } from './shared';
export function Environment({ report }: { report: Report }) {
  const groups: [string, LucideIcon, [string, string | undefined][]][] = [
    ['Environment', Globe, [['Name', report.environment.name], ['Base URL', report.environment.baseUrl], ['API base URL', report.environment.apiBaseUrl]]],
    ['Browser', MonitorSmartphone, [['Target', report.browser.target], ['Channel', report.browser.channel], ['Mode', report.browser.headless ? 'Headless' : 'Headed'], ['Viewport', report.browser.viewport ? `${report.browser.viewport.width} × ${report.browser.viewport.height}` : undefined]]],
    ['Framework', Package, [['Name', report.framework.name], ['Version', report.framework.version], ['Provider', report.framework.activeProvider], ['Generated', date(report.generatedAt)]]],
  ];
  return <><Title eyebrow="EXECUTION CONTEXT" title="Environment & runtime" copy="Platform facts attached to this report." /><div className="env-grid">{groups.map(([name, Icon, rows]) => <section className="panel env" key={name}><h2><span className="panel-ico"><Icon /></span>{name}</h2><dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || 'Not provided'}</dd></div>)}</dl></section>)}</div></>;
}
