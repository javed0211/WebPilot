export const n = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
export const arr = <T,>(value: T[] | null | undefined): T[] => Array.isArray(value) ? value : [];
export const money = (value: unknown): string => `$${n(value).toFixed(n(value) < .1 ? 3 : 2)}`;
export const number = (value: unknown): string => new Intl.NumberFormat().format(n(value));
export const date = (value?: string | number): string => {
  if (value == null) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
};
export const shortDate = (value?: string | number): string => {
  if (value == null) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
export const durationMs = (value: unknown): string => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const seconds = Math.round(Number(value) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
export const statusClass = (value?: string): 'passed' | 'failed' => String(value).toUpperCase() === 'PASSED' ? 'passed' : 'failed';
export const excerpt = (value?: string, max = 180): string => String(value || '').replace(/[#*`[\]()]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
/** Allow relative report paths (`../videos/...`) while blocking dangerous URL schemes. */
export const safePath = (value?: string): string => {
  const s = String(value || '').replace(/\\/g, '/');
  if (/^(?:javascript|data|vbscript):/i.test(s.trim())) return '#';
  return s;
};
/** Normalize evidence JSON paths so they resolve from `runtime/reports/html/`. */
export const evidenceHref = (value?: string): string => {
  const cleaned = safePath(value)
    .replace(/^runtime\/reports\//, '')
    .replace(/^(?:\.\.\/)+/, '');
  if (!cleaned || cleaned === '#') return '#';
  return cleaned.startsWith('http://') || cleaned.startsWith('https://') ? cleaned : `../${cleaned}`;
};
export const isVideoPath = (value?: string): boolean => /\.(webm|mp4|ogg|mov)(?:\?|$)/i.test(String(value || ''));
export const isImagePath = (value?: string): boolean => /\.(png|jpe?g|gif|webp|bmp)(?:\?|$)/i.test(String(value || ''));
export const cap = (value?: string): string => value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/[-_]/g, ' ') : 'Unknown';
export const own = (obj: unknown, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(obj || {}, key);
