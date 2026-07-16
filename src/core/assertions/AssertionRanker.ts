import { AssertionCandidate, AssertionStrength, AssertionSummary } from './AssertionCandidate';
import { TraceSelector, TraceStep } from '../codegen/ExecutionTrace';

const SUCCESS_WORDS = [
  'added',
  'success',
  'submitted',
  'created',
  'saved',
  'updated',
  'deleted',
  'confirmed',
  'complete',
  'completed',
];

const VERIFY_WORDS = ['verify', 'assert', 'check', 'see', 'visible', 'shown', 'displayed', 'loaded'];

function clamp(value: number): number {
  return Math.max(0, Math.min(0.99, Number(value.toFixed(2))));
}

function strengthForScore(score: number): AssertionStrength {
  if (score >= 0.78) return 'strong';
  if (score >= 0.55) return 'medium';
  return 'weak';
}

function lastPathSegment(url?: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean).pop();
    return segment || null;
  } catch {
    return null;
  }
}

function containsWord(haystack: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, 'i').test(haystack);
}

function homepageUrlAssertion(step: TraceStep): AssertionCandidate | null {
  if (step.action !== 'assert' || !step.url) return null;
  try {
    const parsed = new URL(step.url);
    if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
    const normalized = `${parsed.origin}/`;
    return {
      kind: 'url_equals',
      strength: 'medium',
      confidence: 0.74,
      description: `URL is ${normalized}`,
      expected: normalized,
      source: 'url-change',
      signals: ['page-loaded', 'root-url'],
      risks: [],
    };
  } catch {
    return null;
  }
}

function routeAssertion(step: TraceStep, previous?: TraceStep): AssertionCandidate | null {
  if (!step.url) return null;
  const segment = lastPathSegment(step.url);
  if (!segment) return null;
  if (previous?.url === step.url && step.action !== 'navigate') return null;
  const score = step.action === 'navigate' ? 0.68 : 0.6;
  return {
    kind: 'url_contains',
    strength: strengthForScore(score),
    confidence: clamp(score),
    description: `URL contains "${segment}"`,
    expected: segment,
    source: 'url-change',
    signals: ['route-change', 'stable-url-fragment'],
    risks: [],
  };
}

function selectorAssertion(step: TraceStep): AssertionCandidate | null {
  const selector = step.selector;
  if (!selector) return null;
  const intent = step.intent.toLowerCase();
  if (step.action !== 'assert' && !VERIFY_WORDS.some((word) => intent.includes(word))) {
    return null;
  }
  let score = selector.confidence || 0.5;
  if (selector.kind === 'role' || selector.kind === 'testid') score += 0.08;
  if (VERIFY_WORDS.some((word) => intent.includes(word))) score += 0.12;
  if (selector.kind === 'css' || selector.kind === 'xpath') score -= 0.14;

  const kind = selector.kind === 'role' ? 'role_visible' : selector.kind === 'text' ? 'text_visible' : 'element_visible';
  return {
    kind,
    strength: strengthForScore(score),
    confidence: clamp(score),
    description: `${selector.kind} selector is visible`,
    selector,
    source: 'selector',
    signals: ['selector-backed', ...(selector.signals || [])],
    risks: selector.risks || [],
  };
}

function valueAssertion(step: TraceStep): AssertionCandidate | null {
  if (step.action !== 'fill' || !step.selector || !step.value) return null;
  const score = 0.72 + Math.min(0.12, step.selector.confidence / 10);
  return {
    kind: 'value_equals',
    strength: strengthForScore(score),
    confidence: clamp(score),
    description: 'Form value equals entered value',
    selector: step.selector,
    expected: step.value,
    source: 'value',
    signals: ['form-state', 'entered-value'],
    risks: [],
  };
}

function successTextAssertion(step: TraceStep): AssertionCandidate | null {
  const intent = step.intent.toLowerCase();
  const found = SUCCESS_WORDS.find((word) => containsWord(intent, word));
  if (!found) return null;
  const display = found.charAt(0).toUpperCase() + found.slice(1);
  return {
    kind: 'text_visible',
    strength: 'strong',
    confidence: 0.82,
    description: `Success text "${display}" is visible`,
    expected: display,
    source: 'intent',
    signals: ['success-outcome', 'intent-derived'],
    risks: [],
  };
}

function assertTextOrUrlValue(step: TraceStep): AssertionCandidate | null {
  if (step.action !== 'assert' || !step.value) return null;
  if (step.value.startsWith('__url_contains__:')) {
    const expected = step.value.slice('__url_contains__:'.length).trim();
    if (!expected) return null;
    return {
      kind: 'url_contains',
      strength: 'strong',
      confidence: 0.92,
      description: `URL contains "${expected}"`,
      expected,
      source: 'intent',
      signals: ['url-contains', 'nl-derived'],
      risks: [],
    };
  }
  if (step.value.startsWith('__url_equals__:')) {
    const expected = step.value.slice('__url_equals__:'.length).trim();
    if (!expected) return null;
    return {
      kind: 'url_equals',
      strength: 'strong',
      confidence: 0.93,
      description: `URL is ${expected}`,
      expected,
      source: 'intent',
      signals: ['url-equals', 'nl-derived'],
      risks: [],
    };
  }
  // A grounded selector is stronger than repeating the NL value as literal
  // page text (for example, a Booking.com brand link assertion).
  if (step.selector) return null;
  return {
    kind: 'text_visible',
    strength: 'strong',
    confidence: 0.9,
    description: `Text "${step.value}" is visible`,
    expected: step.value,
    // Never attach invented role:link candidates — emitter must use getByText.
    selector: undefined,
    source: 'intent',
    signals: ['nl-derived', 'assert-value'],
    risks: [],
  };
}

function explicitAssert(step: TraceStep, previous?: TraceStep): AssertionCandidate | null {
  if (step.action !== 'assert') return null;
  return (
    assertTextOrUrlValue(step) ||
    selectorAssertion(step) ||
    homepageUrlAssertion(step) ||
    routeAssertion(step, previous) ||
    successTextAssertion(step)
  );
}

export class AssertionRanker {
  public static candidatesForStep(step: TraceStep, previous?: TraceStep): AssertionCandidate[] {
    const candidates = [
      explicitAssert(step, previous),
      homepageUrlAssertion(step),
      successTextAssertion(step),
      valueAssertion(step),
      selectorAssertion(step),
      routeAssertion(step, previous),
    ].filter((candidate): candidate is AssertionCandidate => Boolean(candidate));

    const byKey = new Map<string, AssertionCandidate>();
    for (const candidate of candidates) {
      const key = `${candidate.kind}:${candidate.expected ?? candidate.selector?.expression ?? candidate.selector?.value}`;
      const existing = byKey.get(key);
      if (!existing || existing.confidence < candidate.confidence) {
        byKey.set(key, candidate);
      }
    }
    return [...byKey.values()].sort((a, b) => b.confidence - a.confidence);
  }

  public static primaryForStep(step: TraceStep, previous?: TraceStep): AssertionCandidate | undefined {
    return AssertionRanker.candidatesForStep(step, previous)[0];
  }

  public static summarize(steps: TraceStep[]): AssertionSummary {
    const assertions = steps.flatMap((step) => step.assertions || []);
    const summary: AssertionSummary = {
      total: assertions.length,
      strong: assertions.filter((assertion) => assertion.strength === 'strong').length,
      medium: assertions.filter((assertion) => assertion.strength === 'medium').length,
      weak: assertions.filter((assertion) => assertion.strength === 'weak').length,
      warnings: [],
    };

    if (summary.total === 0) {
      summary.warnings.push('No meaningful assertions were generated for this scenario.');
    }
    if (summary.strong === 0) {
      summary.warnings.push('No strong user-visible outcome assertion was generated.');
    }
    if (summary.weak > 0) {
      summary.warnings.push(`${summary.weak} weak assertion(s) should be reviewed.`);
    }
    return summary;
  }
}
