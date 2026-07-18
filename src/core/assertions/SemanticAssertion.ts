/**
 * Typed semantic assertion AST (schemaVersion 1).
 * No eval / Function — only registered operators and domain checks.
 */

export const SEMANTIC_ASSERTION_SCHEMA_VERSION = 1 as const;

export type ValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'integer'
  | 'decimal'
  | 'currency'
  | 'percentage'
  | 'date'
  | 'datetime';

export type ComparisonOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterOrEqual'
  | 'lessThan'
  | 'lessOrEqual'
  | 'contains'
  | 'exists'
  | 'approximatelyEquals';

export type ArithmeticOperator = 'add' | 'subtract' | 'multiply' | 'divide';

export type ExtractionSourceKind =
  | 'literal'
  | 'variable'
  | 'url'
  | 'title'
  | 'locatorText'
  | 'locatorValue'
  | 'locatorAttribute'
  | 'locatorCount'
  | 'jsonPath'
  | 'header'
  | 'status';

export interface LocatorRef {
  /** Playwright-ish selector expression or CSS/testid shorthand. */
  selector: string;
  kind?: 'testid' | 'role' | 'css' | 'text' | 'label' | 'placeholder';
  name?: string;
  attribute?: string;
}

export interface ExtractionSpec {
  name: string;
  as: ValueType;
  source: {
    kind: ExtractionSourceKind;
    /** For variable/jsonPath/header */
    path?: string;
    locator?: LocatorRef;
    literal?: string | number | boolean;
  };
}

export type SemanticExpression =
  | { kind: 'literal'; value: unknown; as?: ValueType }
  | { kind: 'ref'; name: string }
  | { kind: 'extract'; extraction: ExtractionSpec }
  | {
      kind: 'arithmetic';
      op: ArithmeticOperator;
      left: SemanticExpression;
      right: SemanticExpression;
    }
  | {
      kind: 'array';
      items: SemanticExpression[];
    };

export interface SemanticComparison {
  op: ComparisonOperator;
  left: SemanticExpression;
  right?: SemanticExpression;
  /** Absolute tolerance for approximatelyEquals (currency/decimal). */
  absoluteTolerance?: number;
  /** Relative tolerance 0..1 for approximatelyEquals. */
  relativeTolerance?: number;
}

export interface DomainCheckInvocation {
  id: string;
  arguments: Record<string, SemanticExpression>;
}

export interface SemanticAssertion {
  schemaVersion: typeof SEMANTIC_ASSERTION_SCHEMA_VERSION;
  assertionId: string;
  description?: string;
  /** Extractionsions executed before the assertion (order preserved). */
  extract?: ExtractionSpec[];
  assert?: SemanticComparison;
  domainCheck?: DomainCheckInvocation;
}

export interface SemanticPlan {
  schemaVersion: typeof SEMANTIC_ASSERTION_SCHEMA_VERSION;
  extractions: ExtractionSpec[];
  assertions: SemanticAssertion[];
  /** Lines that could not be parsed (rejected, not invented). */
  rejected: Array<{ line: string; reason: string }>;
}

export type AssertionOutcomeKind =
  | 'passed'
  | 'failed'
  | 'parse_error'
  | 'extraction_error'
  | 'evaluation_error';

export interface AssertionExecutionResult {
  assertionId: string;
  outcome: AssertionOutcomeKind;
  description?: string;
  actual?: unknown;
  expected?: unknown;
  coercions?: string[];
  error?: string;
  durationMs: number;
  extracted?: Record<string, unknown>;
  eventId?: string;
}
