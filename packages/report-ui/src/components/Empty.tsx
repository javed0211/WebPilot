import { Info, type LucideIcon } from 'lucide-react';
export function Empty({ icon: Icon = Info, title, copy }: { icon?: LucideIcon; title: string; copy: string }) {
  return <div className="empty"><Icon /><strong>{title}</strong><p>{copy}</p></div>;
}
