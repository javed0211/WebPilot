import type { ExecutionEventLedger } from '../events/ExecutionEventLedger';
import { DomainCheckRegistry } from './DomainCheckRegistry';
import { EvaluationError, ExpressionEvaluator } from './ExpressionEvaluator';
import { ExtractionError, TypedExtractor, type ExtractionContext } from './TypedExtractor';
import { AssertionResultLedger } from './AssertionResultLedger';
import type {
  AssertionExecutionResult,
  ExtractionSpec,
  SemanticAssertion,
  SemanticPlan,
} from './SemanticAssertion';

export interface SemanticRuntimeOptions {
  context: ExtractionContext;
  eventLedger?: ExecutionEventLedger | null;
}

/**
 * Execute a semantic plan: extractionsions then assertions, recording a result ledger.
 */
export class SemanticAssertionRuntime {
  public static async executePlan(
    plan: SemanticPlan,
    options: SemanticRuntimeOptions
  ): Promise<{
    results: AssertionExecutionResult[];
    variables: Record<string, unknown>;
    ledger: AssertionResultLedger;
  }> {
    const variables = { ...options.context.variables };
    const ctx: ExtractionContext = { ...options.context, variables };
    const ledger = new AssertionResultLedger(options.eventLedger);
    const coercions: string[] = [];

    // Plan-level extractions first
    for (const spec of plan.extractions || []) {
      try {
        const extracted = await TypedExtractor.extract(spec, ctx);
        variables[spec.name] = extracted.value;
        coercions.push(`${spec.name}:${extracted.coercion}`);
      } catch (err) {
        ledger.record({
          assertionId: `extract_${spec.name}`,
          outcome: err instanceof ExtractionError ? 'extraction_error' : 'evaluation_error',
          description: `Extract ${spec.name}`,
          error: err instanceof Error ? err.message : String(err),
          durationMs: 0,
        });
      }
    }

    for (const rejected of plan.rejected) {
      ledger.record({
        assertionId: `rejected_${ledger.getResults().length}`,
        outcome: 'parse_error',
        description: rejected.line,
        error: rejected.reason,
        durationMs: 0,
      });
    }

    for (const assertion of plan.assertions) {
      const result = await SemanticAssertionRuntime.executeAssertion(assertion, ctx, coercions);
      ledger.record(result);
    }

    return { results: [...ledger.getResults()], variables, ledger };
  }

  public static async executeAssertion(
    assertion: SemanticAssertion,
    ctx: ExtractionContext,
    priorCoercions: string[] = []
  ): Promise<AssertionExecutionResult> {
    const started = Date.now();
    const coercions = [...priorCoercions];
    const extracted: Record<string, unknown> = {};

    try {
      for (const spec of assertion.extract || []) {
        const result = await TypedExtractor.extract(spec, ctx);
        ctx.variables[spec.name] = result.value;
        extracted[spec.name] = result.value;
        coercions.push(`${spec.name}:${result.coercion}`);
      }

      const resolve = (name: string) => ctx.variables[name];
      const extractLive = async (spec: ExtractionSpec) => {
        const result = await TypedExtractor.extract(spec, ctx);
        ctx.variables[spec.name] = result.value;
        extracted[spec.name] = result.value;
        coercions.push(`${spec.name}:${result.coercion}`);
        return result.value;
      };

      if (assertion.domainCheck) {
        const ok = await DomainCheckRegistry.run(
          assertion.domainCheck.id,
          assertion.domainCheck.arguments,
          resolve,
          extractLive
        );
        return {
          assertionId: assertion.assertionId,
          outcome: ok ? 'passed' : 'failed',
          description: assertion.description,
          actual: ok,
          expected: true,
          coercions,
          extracted,
          durationMs: Date.now() - started,
          error: ok ? undefined : `Domain check ${assertion.domainCheck.id} failed`,
        };
      }

      if (!assertion.assert) {
        return {
          assertionId: assertion.assertionId,
          outcome: 'evaluation_error',
          description: assertion.description,
          error: 'Assertion has neither assert nor domainCheck',
          durationMs: Date.now() - started,
          coercions,
          extracted,
        };
      }

      const actual = await ExpressionEvaluator.evaluate(
        assertion.assert.left,
        resolve,
        extractLive
      );
      const expected = assertion.assert.right
        ? await ExpressionEvaluator.evaluate(assertion.assert.right, resolve, extractLive)
        : undefined;

      const ok = ExpressionEvaluator.compare(assertion.assert.op, actual, expected, {
        absoluteTolerance: assertion.assert.absoluteTolerance,
        relativeTolerance: assertion.assert.relativeTolerance,
      });

      return {
        assertionId: assertion.assertionId,
        outcome: ok ? 'passed' : 'failed',
        description: assertion.description,
        actual,
        expected,
        coercions,
        extracted,
        durationMs: Date.now() - started,
        error: ok
          ? undefined
          : `Expected ${assertion.assert.op} ${String(expected)}, got ${String(actual)}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome =
        err instanceof ExtractionError
          ? 'extraction_error'
          : err instanceof EvaluationError
            ? 'evaluation_error'
            : 'evaluation_error';
      return {
        assertionId: assertion.assertionId,
        outcome,
        description: assertion.description,
        error: message,
        durationMs: Date.now() - started,
        coercions,
        extracted,
      };
    }
  }
}
