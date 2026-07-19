import type { ExecutionEvent, ExecutionEventBundle, ExecutionEventKind } from '../events/ExecutionEvent';
import { REDACTED } from '../events/EvidenceRedactor';
import type {
  CitationIssue,
  CitationValidationResult,
  RootCauseClaimType,
  RootCauseFinding,
} from './RootCauseTypes';

const KIND_FOR_CLAIM: Record<RootCauseClaimType, ExecutionEventKind[] | '*'> = {
  network_error: ['network'],
  assertion_failure: ['assertion'],
  console_error: ['console'],
  action_failure: ['action'],
  healing_regression: ['healing'],
  page_error: ['page_error'],
  generic: '*',
};

function eventIndex(bundle: ExecutionEventBundle): Map<string, ExecutionEvent> {
  const map = new Map<string, ExecutionEvent>();
  for (const e of bundle.events) {
    map.set(e.eventId, e);
  }
  return map;
}

function isPayloadUseful(event: ExecutionEvent, claimType: RootCauseClaimType): boolean {
  const p = event.payload || {};
  const values = Object.values(p);
  if (values.length === 0) return false;

  const allRedacted = values.every(
    (v) => v === REDACTED || v === null || v === undefined || v === ''
  );
  if (allRedacted) return false;

  if (claimType === 'network_error') {
    const status = p.status;
    const url = p.url;
    const method = p.method;
    // Need at least method+status or a non-redacted URL/errorText
    const hasStatus = typeof status === 'number' || (typeof status === 'string' && status !== REDACTED);
    const hasUrl = typeof url === 'string' && url.length > 0 && url !== REDACTED;
    const hasError = typeof p.errorText === 'string' && p.errorText !== REDACTED;
    const hasMethod = typeof method === 'string' && method !== REDACTED;
    return (hasMethod && hasStatus) || hasUrl || hasError;
  }

  if (claimType === 'assertion_failure') {
    const msg = p.message ?? p.error ?? p.reason ?? p.expression;
    return typeof msg === 'string' ? msg !== REDACTED && msg.length > 0 : true;
  }

  return true;
}

function kindSupports(claimType: RootCauseClaimType, kind: ExecutionEventKind): boolean {
  const allowed = KIND_FOR_CLAIM[claimType];
  if (allowed === '*') return true;
  return allowed.includes(kind);
}

function resolveEffect(
  bundle: ExecutionEventBundle,
  byId: Map<string, ExecutionEvent>,
  effectEventId?: string
): ExecutionEvent | undefined {
  if (effectEventId) {
    return byId.get(effectEventId);
  }
  // Default effect: earliest failed assertion/action, else undefined
  const failed = bundle.events
    .filter((e) => e.outcome === 'failed' && (e.kind === 'assertion' || e.kind === 'action'))
    .sort((a, b) => a.sequence - b.sequence || a.elapsedMs - b.elapsedMs);
  return failed[0];
}

/**
 * Validates that every finding cites real, same-run, temporally valid events
 * whose kinds can support the claim type.
 */
export class CitationValidator {
  public static validate(
    findings: RootCauseFinding[],
    bundle: ExecutionEventBundle,
    options: { effectEventId?: string; failOnInvalidCitation?: boolean } = {}
  ): CitationValidationResult {
    const byId = eventIndex(bundle);
    const effect = resolveEffect(bundle, byId, options.effectEventId);
    const failOnInvalid = options.failOnInvalidCitation !== false;

    const issues: CitationIssue[] = [];
    const accepted: RootCauseFinding[] = [];
    const rejected: RootCauseFinding[] = [];

    for (const finding of findings) {
      const findingIssues = CitationValidator.validateOne(finding, bundle, byId, effect);
      if (findingIssues.length === 0) {
        accepted.push(finding);
      } else {
        issues.push(...findingIssues);
        rejected.push(finding);
      }
    }

    // When failOnInvalidCitation is on, ok means every submitted finding was valid.
    // Callers still use `accepted` to ship only grounded findings.
    return {
      ok: failOnInvalid ? rejected.length === 0 : true,
      issues,
      accepted,
      rejected,
    };
  }

  public static validateOne(
    finding: RootCauseFinding,
    bundle: ExecutionEventBundle,
    byId?: Map<string, ExecutionEvent>,
    effect?: ExecutionEvent
  ): CitationIssue[] {
    const index = byId ?? eventIndex(bundle);
    const issues: CitationIssue[] = [];
    const claimType = finding.claimType || 'generic';

    if (!finding.findingId || !finding.claim || !Array.isArray(finding.causeEventIds)) {
      issues.push({
        findingId: finding.findingId || 'unknown',
        code: 'invalid_structure',
        message: 'Finding missing findingId, claim, or causeEventIds',
      });
      return issues;
    }

    if (finding.causeEventIds.length === 0) {
      issues.push({
        findingId: finding.findingId,
        code: 'empty_causes',
        message: 'Finding has no causeEventIds',
      });
      return issues;
    }

    const allCited = [
      ...finding.causeEventIds,
      ...(finding.supportingEventIds || []),
      ...(finding.contradictoryEventIds || []),
    ];

    for (const eventId of allCited) {
      const event = index.get(eventId);
      if (!event) {
        issues.push({
          findingId: finding.findingId,
          code: 'missing_event',
          message: `Event ${eventId} not found in run bundle`,
          eventId,
        });
        continue;
      }
      if (event.runId !== bundle.header.runId) {
        issues.push({
          findingId: finding.findingId,
          code: 'wrong_run',
          message: `Event ${eventId} belongs to run ${event.runId}, not ${bundle.header.runId}`,
          eventId,
        });
      }
    }

    for (const eventId of finding.causeEventIds) {
      const event = index.get(eventId);
      if (!event) continue;

      if (!kindSupports(claimType, event.kind)) {
        issues.push({
          findingId: finding.findingId,
          code: 'unsupported_kind',
          message: `Event kind "${event.kind}" cannot support claim type "${claimType}"`,
          eventId,
        });
      }

      if (!isPayloadUseful(event, claimType)) {
        issues.push({
          findingId: finding.findingId,
          code: 'redacted_payload',
          message: `Event ${eventId} payload is redacted beyond usefulness for ${claimType}`,
          eventId,
        });
      }

      // Cause must precede effect. Prefer sequence (stable within a run); fall back to elapsedMs.
      if (effect && event.eventId !== effect.eventId) {
        const afterBySequence = event.sequence > effect.sequence;
        const afterByTime =
          event.sequence === effect.sequence && event.elapsedMs > effect.elapsedMs;
        if (afterBySequence || afterByTime) {
          issues.push({
            findingId: finding.findingId,
            code: 'temporal_violation',
            message: `Cause event ${eventId} (seq ${event.sequence}) is after effect ${effect.eventId} (seq ${effect.sequence})`,
            eventId,
          });
        }
      }
    }

    return issues;
  }
}
