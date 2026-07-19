import type { ReactNode } from 'react';

function inline(value: string): ReactNode[] {
  const parts = value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, i) => part.startsWith('**') && part.endsWith('**')
    ? <strong key={i}>{part.slice(2, -2)}</strong>
    : part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part);
}

export function Markdown({ value }: { value?: string }) {
  const lines = String(value || '').replace(/\r/g, '').split('\n'), nodes: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { nodes.push(<ul key={`list-${nodes.length}`}>{list.map((x, i) => <li key={i}>{inline(x)}</li>)}</ul>); list = []; } };
  lines.forEach((line, index) => {
    if (line.startsWith('- ')) { list.push(line.slice(2)); return; }
    flush();
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const Tag = heading[1].length === 3 ? 'h3' : 'h2';
      nodes.push(<Tag key={index}>{inline(heading[2])}</Tag>);
    } else if (line.trim()) nodes.push(<p key={index}>{inline(line)}</p>);
  });
  flush();
  return <div className="markdown">{nodes}</div>;
}
