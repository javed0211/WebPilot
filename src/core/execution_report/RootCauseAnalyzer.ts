import * as fs from 'fs';
import * as path from 'path';
import { PROJECT_ROOT } from '../ProjectPaths';
import type { ExecutionEvent, ExecutionEventBundle } from '../events/ExecutionEvent';
import { ExecutionEventLedger } from '../events/ExecutionEventLedger';
import { CitationValidator } from './CitationValidator';
import {
  ROOT_CAUSE_SCHEMA_VERSION,
  type RootCauseAnalysis,
  type RootCauseAnalyzeOptions,
  type RootCauseClaimType,
  type RootCauseFinding,
} from './RootCauseTypes';

function resolveBundlePath(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (path.isAbsolute(raw)) return raw;
  return path.join(PROJECT_ROOT, raw);
}

function loadBundle(options: RootCauseAnalyzeOptions): ExecutionEventBundle | null {
  if (options.bundle) return options.bundle;
  const abs = resolveBundlePath(options.eventBundlePath);
  if (!abs || !fs.existsSync(abs)) return null;
  try {
    return ExecutionEventLedger.loadBundle(abs);
  } catch {
    return null;
  }
}

function findingId(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}

function networkClaim(event: ExecutionEvent): string {
  const p = event.payload || {};
  const method = String(p.method || 'HTTP');
  const status = p.status != null ? String(p.status) : '';
  const url = String(p.url || '');
  const shortUrl = url.length > 80 ? `${url.slice(0, 77)}…` : url;
  if (status) {
    return `${method} ${shortUrl || '(request)'} returned ${status}${p.statusText ? ` ${p.statusText}` : ''}`;
  }
  if (p.errorText) {
    return `${method} ${shortUrl || '(request)'} failed: ${p.errorText}`;
  }
  return `Network failure on ${method} ${shortUrl || '(unknown URL)'}`;
}

function assertionClaim(event: ExecutionEvent): string {
  const p = event.payload || {};
  const msg = p.message || p.error || p.reason || p.expression || 'Assertion failed';
  return String(msg);
}

function actionClaim(event: ExecutionEvent): string {
  const p = event.payload || {};
  const action = p.action || p.type || 'action';
  const err = p.error || p.message;
  return err ? `Action "${action}" failed: ${err}` : `Action "${action}" failed`;
}

function consoleClaim(event: ExecutionEvent): string {
  const p = event.payload || {};
  const text = String(p.text || p.message || 'Console error');
  return `Browser console ${p.level || 'error'}: ${text.slice(0, 200)}`;
}

function pageErrorClaim(event: ExecutionEvent): string {
  const p = event.payload || {};
  return `Page error: ${String(p.message || p.name || 'unknown')}`;
}

function healingClaim(event: ExecutionEvent): string {
  const p = event.payload || {};
  const label = p.classification || p.label || 'healing change';
  return `Healing classified as ${label}${p.committed === false ? ' (not committed)' : ''}`;
}

/**
 * Builds citation-validated root-cause analysis from the execution event ledger.
 * Deterministic findings are preferred; proposed (LLM) findings must pass CitationValidator.
 */
export class RootCauseAnalyzer {
  public static analyze(options: RootCauseAnalyzeOptions = {}): RootCauseAnalysis {
    const analyzedAt = new Date().toISOString();
    const failOnInvalid = options.failOnInvalidCitation !== false;
    const status = (options.status || '').toUpperCase();
    const bundle = loadBundle(options);

    if (!bundle) {
      return {
        schemaVersion: ROOT_CAUSE_SCHEMA_VERSION,
        status: 'insufficient_evidence',
        summary:
          status === 'PASSED'
            ? 'No failure to diagnose.'
            : 'No execution event ledger available to ground a root-cause claim.',
        findings: [],
        missingEvidence: [
          'event_ledger_bundle',
          'network_capture',
          'assertion_events',
        ],
        scenarioId: options.scenarioId,
        analyzedAt,
      };
    }

    const deterministic = RootCauseAnalyzer.buildDeterministicFindings(bundle);
    const proposed = options.proposedFindings || [];
    const combined = [...deterministic, ...proposed];

    const validation = CitationValidator.validate(combined, bundle, {
      effectEventId: options.effectEventId,
      failOnInvalidCitation: failOnInvalid,
    });

    const accepted = validation.accepted;
    const missingEvidence = RootCauseAnalyzer.detectMissingEvidence(bundle, status, accepted);

    if (accepted.length === 0) {
      return {
        schemaVersion: ROOT_CAUSE_SCHEMA_VERSION,
        status: 'insufficient_evidence',
        summary:
          status === 'PASSED'
            ? 'Run passed; no grounded failure findings.'
            : validation.rejected.length > 0
              ? 'Proposed findings failed citation validation; no grounded root cause.'
              : 'Failure observed but ledger lacks causal evidence for a grounded claim.',
        findings: [],
        missingEvidence:
          missingEvidence.length > 0
            ? missingEvidence
            : validation.issues.map((i) => i.code),
        runId: bundle.header.runId,
        scenarioId: bundle.header.scenarioId || options.scenarioId,
        analyzedAt,
      };
    }

    const primary = accepted[0];
    return {
      schemaVersion: ROOT_CAUSE_SCHEMA_VERSION,
      status: 'grounded',
      summary: primary.claim,
      findings: accepted,
      missingEvidence: missingEvidence.length > 0 ? missingEvidence : undefined,
      runId: bundle.header.runId,
      scenarioId: bundle.header.scenarioId || options.scenarioId,
      analyzedAt,
    };
  }

  public static buildDeterministicFindings(bundle: ExecutionEventBundle): RootCauseFinding[] {
    const findings: RootCauseFinding[] = [];
    let n = 0;

    const push = (
      claimType: RootCauseClaimType,
      claim: string,
      cause: ExecutionEvent,
      supporting: ExecutionEvent[] = [],
      confidence: number
    ) => {
      n += 1;
      findings.push({
        findingId: findingId('rc', n),
        claim,
        claimType,
        confidence,
        causeEventIds: [cause.eventId],
        supportingEventIds: supporting.map((e) => e.eventId),
      });
    };

    const networkFails = bundle.events.filter(
      (e) => e.kind === 'network' && e.outcome === 'failed'
    );
    for (const ev of networkFails) {
      push('network_error', networkClaim(ev), ev, [], 0.9);
    }

    const assertionFails = bundle.events.filter(
      (e) => e.kind === 'assertion' && e.outcome === 'failed'
    );
    for (const ev of assertionFails) {
      const priorNet = networkFails.filter((n) => n.elapsedMs <= ev.elapsedMs).slice(-2);
      push('assertion_failure', assertionClaim(ev), ev, priorNet, 0.85);
    }

    const actionFails = bundle.events.filter(
      (e) => e.kind === 'action' && e.outcome === 'failed'
    );
    for (const ev of actionFails) {
      push('action_failure', actionClaim(ev), ev, [], 0.8);
    }

    const consoleFails = bundle.events.filter(
      (e) =>
        (e.kind === 'console' || e.kind === 'page_error') &&
        e.outcome === 'failed'
    );
    for (const ev of consoleFails) {
      if (ev.kind === 'page_error') {
        push('page_error', pageErrorClaim(ev), ev, [], 0.75);
      } else {
        push('console_error', consoleClaim(ev), ev, [], 0.7);
      }
    }

    const healingRegs = bundle.events.filter((e) => {
      if (e.kind !== 'healing') return false;
      const label = String(e.payload?.classification || e.payload?.label || '');
      return label === 'possible_regression' || e.payload?.committed === false;
    });
    for (const ev of healingRegs) {
      push('healing_regression', healingClaim(ev), ev, [], 0.75);
    }

    return findings;
  }

  public static detectMissingEvidence(
    bundle: ExecutionEventBundle,
    status: string,
    accepted: RootCauseFinding[]
  ): string[] {
    const missing: string[] = [];
    const kinds = new Set(bundle.events.map((e) => e.kind));
    const failed = status === 'FAILED' || status === 'ERROR';

    if (failed && !kinds.has('network')) {
      missing.push('network_capture');
    }
    if (failed && !kinds.has('assertion') && !accepted.some((f) => f.claimType === 'network_error')) {
      missing.push('assertion_events');
    }
    if (failed && accepted.length === 0 && !kinds.has('console') && !kinds.has('page_error')) {
      missing.push('console_capture');
    }
    return missing;
  }

  /** Render markdown compatible with legacy `aiAnalysis` consumers. */
  public static toMarkdown(analysis: RootCauseAnalysis): string {
    const lines: string[] = [];
    lines.push(`## Root cause (${analysis.status})`);
    lines.push('');
    lines.push(analysis.summary);
    lines.push('');

    if (analysis.findings.length > 0) {
      lines.push('### Findings');
      lines.push('');
      for (const f of analysis.findings) {
        const causes = f.causeEventIds.join(', ');
        const support =
          f.supportingEventIds.length > 0
            ? ` (supporting: ${f.supportingEventIds.join(', ')})`
            : '';
        lines.push(
          `- **${f.findingId}** (${f.claimType}, confidence ${f.confidence.toFixed(2)}): ${f.claim}`
        );
        lines.push(`  - Evidence: \`${causes}\`${support}`);
      }
      lines.push('');
    }

    if (analysis.missingEvidence?.length) {
      lines.push('### Missing evidence');
      lines.push('');
      for (const m of analysis.missingEvidence) {
        lines.push(`- ${m}`);
      }
      lines.push('');
    }

    if (analysis.runId) {
      lines.push(`_Run: \`${analysis.runId}\`_`);
    }

    return lines.join('\n').trim() + '\n';
  }
}
