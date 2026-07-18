import type { ExecutionEventLedger } from '../events/ExecutionEventLedger';
import type { AssertionExecutionResult } from './SemanticAssertion';

/**
 * Records assertion outcomes and optionally appends citation-ready events.
 */
export class AssertionResultLedger {
  private readonly results: AssertionExecutionResult[] = [];

  constructor(private readonly eventLedger?: ExecutionEventLedger | null) {}

  public record(result: AssertionExecutionResult): AssertionExecutionResult {
    let eventId: string | undefined;
    if (this.eventLedger) {
      const event = this.eventLedger.append({
        kind: 'assertion',
        phase: 'validate',
        outcome:
          result.outcome === 'passed'
            ? 'passed'
            : result.outcome === 'failed'
              ? 'failed'
              : 'failed',
        payload: {
          assertionId: result.assertionId,
          description: result.description,
          outcomeKind: result.outcome,
          actual: result.actual,
          expected: result.expected,
          coercions: result.coercions,
          error: result.error,
          extracted: result.extracted,
          durationMs: result.durationMs,
        },
      });
      eventId = event.eventId;
    }
    const withEvent = { ...result, eventId };
    this.results.push(withEvent);
    return withEvent;
  }

  public getResults(): readonly AssertionExecutionResult[] {
    return this.results;
  }

  public summary(): {
    total: number;
    passed: number;
    failed: number;
    errors: number;
  } {
    return {
      total: this.results.length,
      passed: this.results.filter((r) => r.outcome === 'passed').length,
      failed: this.results.filter((r) => r.outcome === 'failed').length,
      errors: this.results.filter((r) =>
        ['parse_error', 'extraction_error', 'evaluation_error'].includes(r.outcome)
      ).length,
    };
  }
}
