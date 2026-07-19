import type { RiskLevel } from '../types';
import { n } from '../lib/format';

const polar = (r: number, deg: number) => { const a = (deg - 90) * Math.PI / 180; return [60 + r * Math.cos(a), 60 + r * Math.sin(a)]; };
const arc = (r: number, a0: number, a1: number) => { const [x0, y0] = polar(r, a0), [x1, y1] = polar(r, a1); return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
export function RiskDial({ score = 0, level = 'low', size = 92 }: { score?: number; level?: RiskLevel; size?: number }) {
  const start = -135, sweep = 270, segments = 30, step = sweep / segments, filled = Math.max(0, Math.min(100, n(score))) / 100 * sweep;
  return <div className={`risk-dial ${level}`} style={{ width: size, height: size }} role="img" aria-label={`Risk score ${n(score)} of 100, ${level} risk`}>
    <svg viewBox="0 0 120 120" aria-hidden="true">{Array.from({ length: segments }, (_, i) => <path key={i} className={i * step + step / 2 <= filled ? 'on' : ''} d={arc(47, start + i * step, start + i * step + step - 2.4)} />)}
      {[25, 50, 75].map(v => { const a = start + v / 100 * sweep, [x0, y0] = polar(36, a), [x1, y1] = polar(41, a); return <line key={v} x1={x0} y1={y0} x2={x1} y2={y1} />; })}</svg>
    <div className="dial-value"><b>{n(score)}</b><small>{level} risk</small></div>
  </div>;
}
