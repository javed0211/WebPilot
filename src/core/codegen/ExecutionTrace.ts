import { AssertionCandidate } from '../assertions/AssertionCandidate';

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
  assertions?: AssertionCandidate[];
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
  description: string;
  /** Optional ActHistory locator candidates (preferred over parsing selector JSON). */
  locators?: Array<{ kind: string; value?: string; name?: string; tag?: string }>;
}
