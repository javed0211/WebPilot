import type { SemanticExpression } from './SemanticAssertion';
import { EvaluationError, ExpressionEvaluator } from './ExpressionEvaluator';
import { ValueCoercion } from './ValueCoercion';

export interface DomainCheckContext {
  resolve: (name: string) => unknown;
  evaluate: (expr: SemanticExpression) => Promise<unknown>;
}

export interface DomainCheck {
  id: string;
  description: string;
  requiredArgs: string[];
  run: (args: Record<string, unknown>, ctx: DomainCheckContext) => boolean | Promise<boolean>;
}

const BUILTIN: DomainCheck[] = [
  {
    id: 'money.total_equals_sum',
    description: 'total equals the sum of parts within absolute tolerance (default 0.01)',
    requiredArgs: ['total', 'parts'],
    run: (args) => {
      const total = ValueCoercion.parseNumber(args.total);
      const parts = args.parts;
      if (!Array.isArray(parts)) {
        throw new EvaluationError('money.total_equals_sum requires parts: array');
      }
      const sumCents = parts.reduce(
        (acc: number, p) => acc + ValueCoercion.toCents(ValueCoercion.parseNumber(p)),
        0
      );
      const tol = args.tolerance != null ? ValueCoercion.parseNumber(args.tolerance) : 0.01;
      const totalCents = ValueCoercion.toCents(total);
      return Math.abs(totalCents - sumCents) <= ValueCoercion.toCents(tol);
    },
  },
  {
    id: 'date.end_after_start',
    description: 'end date/time is strictly after start',
    requiredArgs: ['start', 'end'],
    run: (args) => {
      const start = Date.parse(String(ValueCoercion.coerce(args.start, 'datetime')));
      const end = Date.parse(String(ValueCoercion.coerce(args.end, 'datetime')));
      return end > start;
    },
  },
  {
    id: 'collection.count_between',
    description: 'count is between min and max inclusive',
    requiredArgs: ['count', 'min', 'max'],
    run: (args) => {
      const count = ValueCoercion.parseNumber(args.count);
      const min = ValueCoercion.parseNumber(args.min);
      const max = ValueCoercion.parseNumber(args.max);
      return count >= min && count <= max;
    },
  },
  {
    id: 'http.success_status',
    description: 'HTTP status is in 2xx',
    requiredArgs: ['status'],
    run: (args) => {
      const status = ValueCoercion.parseNumber(args.status);
      return status >= 200 && status < 300;
    },
  },
  {
    id: 'inventory.quantity_changed_by',
    description: 'after - before equals delta',
    requiredArgs: ['before', 'after', 'delta'],
    run: (args) => {
      const before = ValueCoercion.parseNumber(args.before);
      const after = ValueCoercion.parseNumber(args.after);
      const delta = ValueCoercion.parseNumber(args.delta);
      return after - before === delta;
    },
  },
];

/**
 * Named, versioned domain predicates — no arbitrary code loading in V1.
 */
export class DomainCheckRegistry {
  private static readonly checks = new Map<string, DomainCheck>(
    BUILTIN.map((c) => [c.id, c])
  );

  public static get(id: string): DomainCheck | undefined {
    return this.checks.get(id);
  }

  public static list(): DomainCheck[] {
    return [...this.checks.values()];
  }

  public static async run(
    id: string,
    argExprs: Record<string, SemanticExpression>,
    resolve: (name: string) => unknown,
    extractLive?: (extraction: import('./SemanticAssertion').ExtractionSpec) => Promise<unknown>
  ): Promise<boolean> {
    const check = this.checks.get(id);
    if (!check) {
      throw new EvaluationError(`Unknown domain check: ${id}`);
    }

    const evaluate = (expr: SemanticExpression) =>
      ExpressionEvaluator.evaluate(expr, resolve, extractLive);

    const args: Record<string, unknown> = {};
    for (const [key, expr] of Object.entries(argExprs)) {
      args[key] = await evaluate(expr);
    }

    for (const required of check.requiredArgs) {
      if (args[required] === undefined) {
        throw new EvaluationError(`Domain check ${id} missing argument: ${required}`);
      }
    }

    return check.run(args, { resolve, evaluate });
  }
}
