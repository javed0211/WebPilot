import * as fs from 'fs';
import * as path from 'path';
import { REPORTS_ROOT } from '../ProjectPaths';
import { REPORTS_DATA_DIR } from '../ReportPaths';

export const REPORTS_EVENTS_DIR = path.join(REPORTS_DATA_DIR, 'events');
export const REPORTS_EVIDENCE_DIR = path.join(REPORTS_DATA_DIR, 'evidence');

export function ensureEventLedgerDirs(): void {
  fs.mkdirSync(REPORTS_EVENTS_DIR, { recursive: true });
  fs.mkdirSync(REPORTS_EVIDENCE_DIR, { recursive: true });
}

export function eventLedgerDir(scenarioId: string): string {
  return path.join(REPORTS_EVENTS_DIR, scenarioId);
}

export function eventLedgerJsonlPath(scenarioId: string, runId: string): string {
  return path.join(eventLedgerDir(scenarioId), `${runId}.jsonl`);
}

export function eventBundlePath(scenarioId: string, runId: string): string {
  return path.join(eventLedgerDir(scenarioId), `${runId}_events.json`);
}

export function replayStepResultsPath(scenarioId: string, runId: string): string {
  return path.join(eventLedgerDir(scenarioId), `${runId}_step-results.json`);
}

/** Path relative to reports root for artifact manifests. */
export function eventBundleHref(scenarioId: string, runId: string): string {
  const abs = eventBundlePath(scenarioId, runId);
  return path.relative(REPORTS_ROOT, abs).replace(/\\/g, '/');
}
