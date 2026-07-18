import * as fs from 'fs';
import * as path from 'path';
import {
  AppendEventInput,
  createEventId,
  createRunId,
  EXECUTION_EVENT_SCHEMA_VERSION,
  ExecutionEvent,
  ExecutionEventBundle,
  ExecutionEventLedgerHeader,
  ExecutionEventSource,
} from './ExecutionEvent';
import { EvidenceRedactor, RedactionOptions } from './EvidenceRedactor';
import { eventLedgerJsonlPath, eventBundlePath, ensureEventLedgerDirs } from './EventPaths';

export interface ExecutionEventLedgerOptions {
  scenarioId: string;
  source: ExecutionEventSource;
  runId?: string;
  redaction?: RedactionOptions;
  /** When false, events stay in memory only (tests / disabled feature). */
  persist?: boolean;
}

/**
 * Append-only execution event ledger.
 * Dual-writes JSONL during the run and a finalized JSON bundle on close.
 */
export class ExecutionEventLedger {
  public readonly runId: string;
  public readonly scenarioId: string;
  public readonly source: ExecutionEventSource;

  private readonly startedAt: Date;
  private readonly startedMs: number;
  private readonly events: ExecutionEvent[] = [];
  private readonly redaction: RedactionOptions;
  private readonly persist: boolean;
  private sequence = 0;
  private closed = false;
  private jsonlPath: string | null = null;

  constructor(options: ExecutionEventLedgerOptions) {
    this.scenarioId = options.scenarioId;
    this.source = options.source;
    this.startedAt = new Date();
    this.startedMs = Date.now();
    this.runId = options.runId || createRunId(options.scenarioId, this.startedAt);
    this.redaction = options.redaction || {};
    this.persist = options.persist !== false;

    if (this.persist) {
      ensureEventLedgerDirs();
      this.jsonlPath = eventLedgerJsonlPath(this.scenarioId, this.runId);
      fs.mkdirSync(path.dirname(this.jsonlPath), { recursive: true });
      // Truncate any prior partial ledger for the same runId.
      fs.writeFileSync(this.jsonlPath, '', 'utf8');
    }
  }

  public get eventCount(): number {
    return this.events.length;
  }

  public getEvents(): readonly ExecutionEvent[] {
    return this.events;
  }

  public append(input: AppendEventInput): ExecutionEvent {
    if (this.closed) {
      throw new Error(`Cannot append to closed event ledger ${this.runId}`);
    }

    this.sequence += 1;
    const event: ExecutionEvent = {
      schemaVersion: EXECUTION_EVENT_SCHEMA_VERSION,
      eventId: createEventId(this.runId, this.sequence),
      runId: this.runId,
      scenarioId: this.scenarioId,
      stepId: input.stepId,
      stepIndex: input.stepIndex,
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - this.startedMs,
      source: input.source || this.source,
      kind: input.kind,
      phase: input.phase || 'execute',
      outcome: input.outcome || 'info',
      parentEventId: input.parentEventId,
      payload: EvidenceRedactor.redactStructured(input.payload || {}, this.redaction),
    };

    this.events.push(event);

    if (this.persist && this.jsonlPath) {
      fs.appendFileSync(this.jsonlPath, `${JSON.stringify(event)}\n`, 'utf8');
    }

    return event;
  }

  public appendLifecycle(
    name: string,
    outcome: ExecutionEvent['outcome'] = 'started',
    payload: Record<string, unknown> = {}
  ): ExecutionEvent {
    return this.append({
      kind: 'lifecycle',
      phase: 'setup',
      outcome,
      payload: { name, ...payload },
    });
  }

  public appendAction(input: {
    action: string;
    stepIndex: number;
    outcome: ExecutionEvent['outcome'];
    locator?: string;
    url?: string;
    error?: string;
    healed?: boolean;
    extra?: Record<string, unknown>;
  }): ExecutionEvent {
    return this.append({
      kind: 'action',
      phase: 'execute',
      outcome: input.outcome,
      stepIndex: input.stepIndex,
      stepId: `step-${input.stepIndex}`,
      payload: {
        action: input.action,
        locator: input.locator,
        url: input.url ? EvidenceRedactor.redactUrl(input.url) : undefined,
        error: input.error,
        healed: input.healed,
        ...(input.extra || {}),
      },
    });
  }

  public toBundle(finishedAt: Date = new Date()): ExecutionEventBundle {
    const header: ExecutionEventLedgerHeader = {
      schemaVersion: EXECUTION_EVENT_SCHEMA_VERSION,
      runId: this.runId,
      scenarioId: this.scenarioId,
      startedAt: this.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      source: this.source,
      eventCount: this.events.length,
      redacted: true,
    };
    return { header, events: [...this.events] };
  }

  /**
   * Finalize the ledger: write the validated bundle and mark closed.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  public finalize(): ExecutionEventBundle {
    if (this.closed) {
      return this.toBundle();
    }

    const bundle = this.toBundle();
    this.closed = true;

    if (this.persist) {
      const outPath = eventBundlePath(this.scenarioId, this.runId);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2), 'utf8');
    }

    return bundle;
  }

  public static loadBundle(filePath: string): ExecutionEventBundle {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ExecutionEventBundle;
    if (!raw?.header || !Array.isArray(raw.events)) {
      throw new Error(`Invalid event bundle: ${filePath}`);
    }
    if (raw.header.schemaVersion !== EXECUTION_EVENT_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported event bundle schemaVersion ${raw.header.schemaVersion} in ${filePath}`
      );
    }
    return raw;
  }

  public static findEvent(
    bundle: ExecutionEventBundle,
    eventId: string
  ): ExecutionEvent | undefined {
    return bundle.events.find((e) => e.eventId === eventId);
  }
}
