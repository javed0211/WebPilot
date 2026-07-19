import { Check, X } from 'lucide-react';
import { statusClass } from '../lib/format';

export function Status({ value }: { value?: string }) {
  const passed = statusClass(value) === 'passed';
  return <span className={`status ${passed ? 'is-pass' : 'is-fail'}`}>{passed ? <Check /> : <X />}{passed ? 'Passed' : (value || 'Failed')}</span>;
}
