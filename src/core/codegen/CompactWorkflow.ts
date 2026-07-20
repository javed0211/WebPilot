import type {
  ActLocator,
  ActStep,
  CompactWorkflow,
  CompactWorkflowCoverage,
  CompactWorkflowStep,
} from '../replay/ActHistoryTypes';

const INTERACTIVE = new Set(['click', 'input', 'fill', 'type', 'select', 'select_dropdown']);

/** Convert compactWorkflow.steps into ActStep rows for replay/codegen. */
export function compactWorkflowToActSteps(compact: CompactWorkflow | null | undefined): ActStep[] {
  if (!compact?.steps?.length) return [];
  return compact.steps.map((step, i) => {
    const ordered = uniqueLocators([
      step.locator || undefined,
      ...(step.semanticLocators || []),
      ...(step.selectorCandidates || []),
    ]);
    return {
      index: step.index ?? i + 1,
      action: String(step.action || 'custom'),
      value: step.value ?? null,
      url: step.url ?? null,
      description: String(step.nlStep || step.description || step.action || `step ${i + 1}`),
      locators: ordered,
      selector: ordered.length ? JSON.stringify(ordered) : undefined,
      pageTitle: step.pageTitle ?? null,
      elementIndex: step.elementIndex ?? null,
    };
  });
}

function uniqueLocators(locs: Array<ActLocator | null | undefined>): ActLocator[] {
  const out: ActLocator[] = [];
  const seen = new Set<string>();
  for (const loc of locs) {
    if (!loc || typeof loc !== 'object') continue;
    const key = `${loc.kind || ''}:${loc.value || ''}:${loc.name || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(loc);
  }
  return out;
}

export function getCompactWorkflow(doc: Record<string, unknown> | null | undefined): CompactWorkflow | null {
  if (!doc) return null;
  const raw = doc.compactWorkflow;
  if (!raw || typeof raw !== 'object') return null;
  const cw = raw as CompactWorkflow;
  if (!Array.isArray(cw.steps)) return null;
  return cw;
}

export function formatCompactCoverageLog(compact: CompactWorkflow | null | undefined): string {
  if (!compact) return '';
  const cov = compact.coverage || { nlTotal: 0, mapped: 0, unmapped: [] };
  return (
    `Compact workflow: ${compact.steps.length} steps ` +
    `(dropped ${compact.dropped?.length || 0}); ` +
    `NL coverage ${cov.mapped}/${cov.nlTotal}`
  );
}

/**
 * NL coverage gate.
 * WEBPILOT_COMPACT_COVERAGE_GATE=0 → warn only (never block).
 * Default when codegen: block if unmapped NL steps remain.
 */
export function evaluateCompactCoverageGate(
  compact: CompactWorkflow | null | undefined,
  options: { codegen?: boolean } = {}
): { ok: boolean; warnOnly: boolean; message: string; coverage?: CompactWorkflowCoverage } {
  const env = process.env.WEBPILOT_COMPACT_COVERAGE_GATE?.trim().toLowerCase();
  const warnOnly = env === '0' || env === 'false' || env === 'off' || env === 'warn';
  if (!compact) {
    return {
      ok: true,
      warnOnly: true,
      message: 'No compactWorkflow on history document — coverage gate skipped',
    };
  }
  const cov = compact.coverage || { nlTotal: 0, mapped: 0, unmapped: [] as string[] };
  const unmapped = cov.unmapped || [];
  if (!unmapped.length) {
    return {
      ok: true,
      warnOnly,
      message: `NL coverage ${cov.mapped}/${cov.nlTotal}`,
      coverage: cov,
    };
  }
  const detail = unmapped
    .slice(0, 8)
    .map((s) => `  - ${s}`)
    .join('\n');
  const message =
    `Compact workflow NL coverage incomplete (${cov.mapped}/${cov.nlTotal}). Unmapped:\n${detail}` +
    (unmapped.length > 8 ? `\n  … +${unmapped.length - 8} more` : '');
  // Block by default when running codegen unless explicitly warn-only.
  const shouldBlock = options.codegen !== false && !warnOnly;
  return { ok: !shouldBlock, warnOnly, message, coverage: cov };
}

/**
 * Verified-locator gate (off by default).
 * WEBPILOT_COMPACT_REQUIRE_VERIFIED=1 blocks codegen when interactive steps lack verified locators.
 */
export function evaluateCompactVerifiedGate(
  compact: CompactWorkflow | null | undefined
): { ok: boolean; message: string; unverified: CompactWorkflowStep[] } {
  const require =
    process.env.WEBPILOT_COMPACT_REQUIRE_VERIFIED?.trim().toLowerCase() === '1' ||
    process.env.WEBPILOT_COMPACT_REQUIRE_VERIFIED?.trim().toLowerCase() === 'true';
  if (!require || !compact?.steps?.length) {
    return { ok: true, message: '', unverified: [] };
  }
  const unverified = compact.steps.filter((s) => {
    const action = String(s.action || '').toLowerCase();
    if (!INTERACTIVE.has(action)) return false;
    return !s.verified;
  });
  if (!unverified.length) {
    return { ok: true, message: 'All interactive compact steps verified', unverified: [] };
  }
  return {
    ok: false,
    message:
      `Compact workflow verified-locator gate failed: ${unverified.length} interactive step(s) unverified. ` +
      `Set WEBPILOT_COMPACT_REQUIRE_VERIFIED=0 to bypass.`,
    unverified,
  };
}
