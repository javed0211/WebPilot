import { TraceSelector } from '../codegen/ExecutionTrace';
import type { SemanticAssertion } from './SemanticAssertion';

export type AssertionKind =
  | 'url_contains'
  | 'url_equals'
  | 'role_visible'
  | 'text_visible'
  | 'element_visible'
  | 'value_equals'
  | 'count_at_least'
  | 'enabled'
  | 'disabled'
  | 'semantic';

export type AssertionStrength = 'strong' | 'medium' | 'weak';

export interface AssertionCandidate {
  kind: AssertionKind;
  strength: AssertionStrength;
  confidence: number;
  description: string;
  selector?: TraceSelector;
  expected?: string | number | boolean;
  source: 'intent' | 'url-change' | 'selector' | 'value' | 'fallback' | 'semantic';
  signals: string[];
  risks: string[];
  /** Present when kind === 'semantic'. */
  semantic?: SemanticAssertion;
}

export interface AssertionSummary {
  total: number;
  strong: number;
  medium: number;
  weak: number;
  warnings: string[];
}
