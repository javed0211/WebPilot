import { AssertionCandidate } from '../assertions/AssertionCandidate';
import type { SemanticPlan } from '../assertions/SemanticAssertion';

export type TraceAction =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select'
  | 'assert'
  | 'wait'
  | 'go_back'
  | 'screenshot'
  | 'press'
  | 'custom';

export type SelectorKind = 'role' | 'label' | 'placeholder' | 'testid' | 'text' | 'css' | 'xpath' | 'unknown';

export interface TraceSelector {
  kind: SelectorKind;
  value: string;
  expression?: string;
  confidence: number;
  signals?: string[];
  risks?: string[];
  fallbacks?: TraceSelector[];
}

export interface TraceStep {
  index: number;
  intent: string;
  action: TraceAction;
  selector?: TraceSelector;
  url?: string;
  value?: string;
  description: string;
  pageCandidate?: string;
  /** URL before this step executed (page-state context for mapping). */
  urlBefore?: string;
  /** URL after this step executed (navigation outcome). */
  urlAfter?: string;
  /** Human-meaningful target ("Products navigation link"), derived from locators. */
  semanticTarget?: string;
  assertions?: AssertionCandidate[];
  /** Parsed semantic assertion plan when the intent uses the DSL. */
  semanticPlan?: SemanticPlan;
  /** Cookie/dialog dismiss — pageMethodBody emits if-present click. */
  optional?: boolean;
}

export interface ExecutionTrace {
  version: string;
  scenario: string;
  scenarioSlug: string;
  sourceFile?: string;
  targetUrl?: string;
  generatedAt: string;
  steps: TraceStep[];
}

export interface RawExecutionStep {
  index?: number;
  action: string;
  selector?: string | null;
  value?: string | null;
  url?: string | null;
  urlBefore?: string | null;
  urlAfter?: string | null;
  description: string;
  /** Optional ActHistory locator candidates (preferred over parsing selector JSON). */
  locators?: Array<{ kind: string; value?: string; name?: string; tag?: string }>;
  /** Cookie/dialog dismiss — emit if-present click in codegen. */
  optional?: boolean;
}

/** All URL candidates for page mapping — step.url alone loses assert/merged-step context. */
export function stepUrlCandidates(step: TraceStep): string[] {
  const urls = [step.url, step.pageCandidate, step.urlBefore, step.urlAfter];
  return [...new Set(urls.filter(Boolean) as string[])];
}
