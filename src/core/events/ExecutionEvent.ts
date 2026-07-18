/**
 * Schema-versioned execution events for the shared evidence ledger.
 * Events are append-only during a run and finalized into a validated bundle.
 */

export const EXECUTION_EVENT_SCHEMA_VERSION = 1 as const;

export type ExecutionEventSource =
  | 'ui'
  | 'replay'
  | 'browser-use'
  | 'api'
  | 'lifecycle'
  | 'healing'
  | 'assertion';

export type ExecutionEventKind =
  | 'lifecycle'
  | 'action'
  | 'assertion'
  | 'network'
  | 'console'
  | 'healing'
  | 'artifact'
  | 'page_error';

export type ExecutionEventPhase =
  | 'setup'
  | 'seed'
  | 'auth'
  | 'execute'
  | 'validate'
  | 'cleanup'
  | 'teardown'
  | 'finalize';

export type ExecutionEventOutcome = 'started' | 'passed' | 'failed' | 'skipped' | 'info';

export interface ExecutionEvent {
  schemaVersion: typeof EXECUTION_EVENT_SCHEMA_VERSION;
  eventId: string;
  runId: string;
  scenarioId: string;
  stepId?: string;
  stepIndex?: number;
  sequence: number;
  timestamp: string;
  /** Monotonic ms since run start (preferred for causal ordering). */
  elapsedMs: number;
  source: ExecutionEventSource;
  kind: ExecutionEventKind;
  phase: ExecutionEventPhase;
  outcome: ExecutionEventOutcome;
  parentEventId?: string;
  /** Redacted structured payload. Never store secrets here. */
  payload: Record<string, unknown>;
}

export interface ExecutionEventLedgerHeader {
  schemaVersion: typeof EXECUTION_EVENT_SCHEMA_VERSION;
  runId: string;
  scenarioId: string;
  startedAt: string;
  finishedAt?: string;
  source: ExecutionEventSource;
  eventCount: number;
  redacted: boolean;
}

export interface ExecutionEventBundle {
  header: ExecutionEventLedgerHeader;
  events: ExecutionEvent[];
}

export interface AppendEventInput {
  kind: ExecutionEventKind;
  phase?: ExecutionEventPhase;
  outcome?: ExecutionEventOutcome;
  source?: ExecutionEventSource;
  stepId?: string;
  stepIndex?: number;
  parentEventId?: string;
  payload?: Record<string, unknown>;
}

export function createRunId(scenarioId: string, at: Date = new Date()): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${scenarioId}-${stamp}`;
}

export function createEventId(runId: string, sequence: number): string {
  return `${runId}#${String(sequence).padStart(5, '0')}`;
}
