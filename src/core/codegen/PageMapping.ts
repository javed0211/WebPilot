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
 * Among all URL candidates, prefer the most specific matching page pattern
 * so a click recorded with urlBefore=home and url=article lands on the article
 * POM rather than the first homepage match.
 */
export function pageForStep(
  step: TraceStep,
  pages: PlannedFile[],
  trace?: ExecutionTrace
): PlannedFile | undefined {
  const candidates = ['click', 'fill', 'select', 'press'].includes(step.action)
    ? ([step.url, step.pageCandidate, step.urlBefore, step.urlAfter].filter(Boolean) as string[])
    : stepUrlCandidates(step);
  if (trace) {
    const position = trace.steps.indexOf(step);
    // Stay inside the current navigation segment. Once a navigate or an
    // observed urlBefore→urlAfter transition is reached, walking farther can
    // incorrectly pull an assertion back onto an earlier page object.
    for (let cursor = position - 1; cursor >= 0; cursor--) {
      const before = trace.steps[cursor];
      const transitioned = Boolean(
        before.urlBefore &&
          before.urlAfter &&
          normalizeUrlKey(before.urlBefore) !== normalizeUrlKey(before.urlAfter)
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
      if (after.action === 'navigate') {
        if (after.urlBefore) candidates.push(after.urlBefore);
        break;
      }
      if (after.urlBefore) candidates.push(after.urlBefore);
      else if (after.pageCandidate) candidates.push(after.pageCandidate);
      const transitioned = Boolean(
        after.urlBefore &&
          after.urlAfter &&
          normalizeUrlKey(after.urlBefore) !== normalizeUrlKey(after.urlAfter)
      );
      if (transitioned) break;
    }
  }

  let best: { page: PlannedFile; score: number } | null = null;
  for (const url of [...new Set(candidates)]) {
    for (const page of pages) {
      if (!page.urlPattern || !urlsMatchPage(page.urlPattern, url)) continue;
      let score = pagePatternSpecificity(page.urlPattern, url);
      // An explicit step.url that matches this page is authoritative — don't let
      // neighboring article URLs steal homepage/url_equals asserts.
      if (step.url && urlsMatchPage(page.urlPattern, step.url) && url === step.url) {
        score += 1000;
      }
      if (!best || score > best.score) best = { page, score };
    }
  }
  return best?.page;
}

function pagePatternSpecificity(pattern: string, url: string): number {
  try {
    const path = new URL(url).pathname.replace(/\/$/, '') || '/';
    const pathScore = path === '/' ? 1 : path.length;
    return pathScore + Math.min(pattern.length, 80) / 1000;
  } catch {
    return pattern.length;
  }
}

/** All steps assigned to this page (each step maps to at most one page). */
export function stepsForPage(
  page: PlannedFile,
  trace: ExecutionTrace,
  pages: PlannedFile[]
): TraceStep[] {
  return trace.steps.filter((step) => pageForStep(step, pages, trace) === page);
}
