import { ExecutionTrace, stepUrlCandidates, TraceStep } from './ExecutionTrace';
import { PlannedFile } from './GenerationPlan';

function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, '') || '/';
    return `${parsed.origin}${path}`;
  } catch {
    return url.replace(/\/$/, '') || url;
  }
}

export function urlsMatchPage(pattern: string, url: string): boolean {
  if (!pattern || !url) return false;
  const regex = pattern.match(/^\/([\s\S]+)\/([a-z]*)$/i);
  if (regex) {
    try {
      return new RegExp(regex[1], regex[2]).test(url);
    } catch {
      return false;
    }
  }
  if (/^https?:\/\//i.test(pattern)) {
    if (normalizeUrlKey(pattern) === normalizeUrlKey(url)) return true;
    try {
      const expected = new URL(pattern);
      const actual = new URL(url);
      return (
        expected.origin === actual.origin &&
        (expected.pathname === '/' || expected.pathname === '') &&
        /^\/(?:index|default)(?:\.[a-z]{2}(?:-[a-z]{2})?)?\.(?:html?|php|aspx)$/i.test(actual.pathname)
      );
    } catch {
      return false;
    }
  }
  return url.includes(pattern);
}

/**
 * Map a trace step to exactly one planned page object.
 *
 * URL candidates are tried in priority order — the URL where the action
 * happened first (url/pageCandidate/urlBefore), landing page (urlAfter) last.
 * This prevents a click that navigates home→results from being assigned to
 * both pages.
 */
export function pageForStep(
  step: TraceStep,
  pages: PlannedFile[],
  trace?: ExecutionTrace
): PlannedFile | undefined {
  // Browser-use records step.url after an action. For interactions that may
  // navigate, urlBefore is therefore the best indication of which POM owns the
  // element. Assertions/screenshots describe the resulting active page.
  const candidates = ['click', 'fill', 'select', 'press'].includes(step.action)
    ? [step.urlBefore, step.url, step.pageCandidate, step.urlAfter].filter(Boolean) as string[]
    : stepUrlCandidates(step);
  if (trace) {
    const position = trace.steps.indexOf(step);
    // Stay inside the current navigation segment. Once a navigate or an
    // observed urlBefore→urlAfter transition is reached, walking farther can
    // incorrectly pull an assertion back onto an earlier page object.
    for (let cursor = position - 1; cursor >= 0; cursor--) {
      const before = trace.steps[cursor];
      const transitioned = Boolean(
        before.urlBefore && before.urlAfter && normalizeUrlKey(before.urlBefore) !== normalizeUrlKey(before.urlAfter)
      );
      if (transitioned) {
        if (before.urlAfter) candidates.push(before.urlAfter);
        break;
      }
      candidates.push(...stepUrlCandidates(before));
      if (before.action === 'navigate') break;
    }
    for (let cursor = position + 1; position >= 0 && cursor < trace.steps.length; cursor++) {
      const after = trace.steps[cursor];
      // A following navigation begins a new segment; only its pre-navigation
      // context can describe the current step.
      if (after.action === 'navigate') {
        if (after.urlBefore) candidates.push(after.urlBefore);
        break;
      }
      if (after.urlBefore) candidates.push(after.urlBefore);
      else if (after.pageCandidate) candidates.push(after.pageCandidate);
      const transitioned = Boolean(
        after.urlBefore && after.urlAfter && normalizeUrlKey(after.urlBefore) !== normalizeUrlKey(after.urlAfter)
      );
      if (transitioned) break;
    }
  }
  for (const url of candidates) {
    const match = pages.find((page) => page.urlPattern && urlsMatchPage(page.urlPattern, url));
    if (match) return match;
  }
  return undefined;
}

/** All steps assigned to this page (each step maps to at most one page). */
export function stepsForPage(
  page: PlannedFile,
  trace: ExecutionTrace,
  pages: PlannedFile[]
): TraceStep[] {
  return trace.steps.filter((step) => pageForStep(step, pages, trace) === page);
}
