import { ChevronRight, type LucideIcon } from 'lucide-react';

export const AiGlyph = () => <span className="ai-glyph" aria-hidden="true">AI</span>;

export function PanelHead({ title, copy, action, icon: Icon }: { title: string; copy?: string; action?: string; icon?: LucideIcon }) {
  return <header className="panel-head">{Icon && <span className="panel-ico"><Icon /></span>}<div><h2>{title}</h2>{copy && <p>{copy}</p>}</div>{action && <a href={action}>View all <ChevronRight /></a>}</header>;
}
export function Title({ eyebrow = 'EXECUTION REPORT', title, copy }: { eyebrow?: string; title: string; copy?: string }) {
  return <div className="page-intro"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{copy && <p>{copy}</p>}</div></div>;
}
export function Metric({ icon: Icon, label, value, note }: { icon?: LucideIcon; label: string; value: string; note?: string }) {
  return <div className="metric">{Icon && <Icon />}<div><label>{label}</label><b>{value}</b>{note && <small>{note}</small>}</div></div>;
}
