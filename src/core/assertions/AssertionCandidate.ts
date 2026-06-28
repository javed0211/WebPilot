import { TraceSelector } from '../codegen/ExecutionTrace';

export type AssertionKind =
  | 'url_contains'
  | 'url_equals'
  | 'role_visible'
  | 'text_visible'
  | 'element_visible'
  | 'value_equals'
  | 'count_at_least'
  | 'enabled'
  | 'disabled';

export type AssertionStrength = 'strong' | 'medium' | 'weak';

export interface AssertionCandidate {
  kind: AssertionKind;
  strength: AssertionStrength;
  confidence: number;
  description: string;
  selector?: TraceSelector;
  expected?: string | number | boolean;
  source: 'intent' | 'url-change' | 'selector' | 'value' | 'fallback';
  signals: string[];
  risks: string[];
}

export interface AssertionSummary {
  total: number;
  strong: number;
  medium: number;
  weak: number;
  warnings: string[];
}
