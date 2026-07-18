import type {
  ArithmeticOperator,
  ComparisonOperator,
  SemanticExpression,
  ValueType,
} from './SemanticAssertion';
import { CoercionError, ValueCoercion } from './ValueCoercion';

export interface EvaluateOptions {
  absoluteTolerance?: number;
  relativeTolerance?: number;
  /** Prefer cent-based arithmetic when both sides look monetary. */
  asCurrency?: boolean;
}

export class EvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationError';
  }
}

type ResolveRef = (name: string) => unknown;

export class ExpressionEvaluator {
  public static async evaluate(
    expr: SemanticExpression,
    resolve: ResolveRef,
    extractLive?: (extraction: import('./SemanticAssertion').ExtractionSpec) => Promise<unknown>
  ): Promise<unknown> {
    switch (expr.kind) {
      case 'literal':
        return expr.as
          ? ValueCoercion.coerce(expr.value, expr.as)
          : expr.value;
      case 'ref': {
        const value = resolve(expr.name);
        if (value === undefined) {
          throw new EvaluationError(`Unknown variable: ${expr.name}`);
        }
        return value;
      }
      case 'extract': {
        if (!extractLive) {
          throw new EvaluationError(`Cannot evaluate inline extract without extractor`);
        }
        return extractLive(expr.extraction);
      }
      case 'arithmetic': {
        const left = await ExpressionEvaluator.evaluate(expr.left, resolve, extractLive);
        const right = await ExpressionEvaluator.evaluate(expr.right, resolve, extractLive);
        return ExpressionEvaluator.arithmetic(expr.op, left, right);
      }
      case 'array': {
        const items: unknown[] = [];
        for (const item of expr.items) {
          items.push(await ExpressionEvaluator.evaluate(item, resolve, extractLive));
        }
        return items;
      }
      default:
        throw new EvaluationError(`Unsupported expression kind`);
    }
  }

  public static arithmetic(op: ArithmeticOperator, left: unknown, right: unknown): number {
    const l = ValueCoercion.parseNumber(left);
    const r = ValueCoercion.parseNumber(right);
    // Use cents when both values have at most 2 decimal places (money-safe).
    const useCents = ExpressionEvaluator.looksLikeMoney(l) && ExpressionEvaluator.looksLikeMoney(r);
    if (useCents && (op === 'add' || op === 'subtract')) {
      const lc = ValueCoercion.toCents(l);
      const rc = ValueCoercion.toCents(r);
      const result = op === 'add' ? lc + rc : lc - rc;
      return ValueCoercion.fromCents(result);
    }
    switch (op) {
      case 'add':
        return l + r;
      case 'subtract':
        return l - r;
      case 'multiply':
        return l * r;
      case 'divide':
        if (r === 0) throw new EvaluationError('Division by zero');
        return l / r;
      default:
        throw new EvaluationError(`Unknown arithmetic op: ${op}`);
    }
  }

  public static compare(
    op: ComparisonOperator,
    actual: unknown,
    expected: unknown | undefined,
    options: EvaluateOptions = {}
  ): boolean {
    if (op === 'exists') {
      return actual !== undefined && actual !== null && actual !== '';
    }
    if (expected === undefined) {
      throw new EvaluationError(`Operator ${op} requires an expected value`);
    }

    switch (op) {
      case 'equals':
        return ExpressionEvaluator.looseEqual(actual, expected);
      case 'notEquals':
        return !ExpressionEvaluator.looseEqual(actual, expected);
      case 'contains':
        return String(actual).includes(String(expected));
      case 'greaterThan':
        return ValueCoercion.parseNumber(actual) > ValueCoercion.parseNumber(expected);
      case 'greaterOrEqual':
        return ValueCoercion.parseNumber(actual) >= ValueCoercion.parseNumber(expected);
      case 'lessThan':
        return ValueCoercion.parseNumber(actual) < ValueCoercion.parseNumber(expected);
      case 'lessOrEqual':
        return ValueCoercion.parseNumber(actual) <= ValueCoercion.parseNumber(expected);
      case 'approximatelyEquals': {
        const a = ValueCoercion.parseNumber(actual);
        const e = ValueCoercion.parseNumber(expected);
        const absTol = options.absoluteTolerance ?? 0.01;
        const relTol = options.relativeTolerance;
        const absOk = Math.abs(a - e) <= absTol + Number.EPSILON;
        if (relTol != null && relTol >= 0) {
          const denom = Math.max(Math.abs(e), Number.EPSILON);
          return absOk || Math.abs(a - e) / denom <= relTol;
        }
        return absOk;
      }
      default:
        throw new EvaluationError(`Unknown comparison op: ${op}`);
    }
  }

  private static looseEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    try {
      if (typeof a === 'number' || typeof b === 'number') {
        return ValueCoercion.parseNumber(a) === ValueCoercion.parseNumber(b);
      }
    } catch (err) {
      if (!(err instanceof CoercionError)) throw err;
    }
    return String(a) === String(b);
  }

  private static looksLikeMoney(n: number): boolean {
    return Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-8;
  }
}

export function suggestType(value: unknown): ValueType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'decimal';
  }
  return 'string';
}
