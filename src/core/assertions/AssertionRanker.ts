import { AssertionCandidate, AssertionStrength, AssertionSummary } from './AssertionCandidate';
import { TraceSelector, TraceStep } from '../codegen/ExecutionTrace';
import { AssertionDslParser } from './AssertionDslParser';
import { stripLocaleFromUrlFragment } from './LocaleUrl';

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

/** Strip verify/assert boilerplate to a likely on-page text fragment. */
export function extractAssertText(step: string): string | null {
  let text = step.trim();
  text = text.replace(/^(verify|assert|check|ensure)\s+/i, '');
  text = text.replace(/\s+(is|are)\s+(visible|displayed|shown|present|loaded).*$/i, '');
  text = text.replace(/\s+loads?\s+successfully.*$/i, '');
  text = text.replace(/^that\s+/i, '');
  text = text.replace(/^the\s+/i, '');
  text = text.replace(/\s+section$/i, '');
  text = text.replace(/\s+page$/i, '');
  text = text.replace(/\s+(link|button|heading|menu|tab|checkbox|radio)$/i, '');
  text = text.replace(/[."']+$/g, '').trim();
  if (!text || text.length > 120) return null;
  // Still looks like an instruction, not page copy.
  if (/^(verify|assert|check|ensure)\b/i.test(text)) return null;
  return text;
}

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
  const segment = stripLocaleFromUrlFragment(lastPathSegment(step.url) || '');
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
  // Combobox/autocomplete fields (Booking destination, etc.) often keep an empty
  // native value while showing typed text in a custom widget — toHaveValue flakes.
  const role = String(step.selector.value || '').toLowerCase();
  const expr = `${step.selector.expression || ''} ${step.selector.value || ''}`.toLowerCase();
  if (
    step.selector.kind === 'role' &&
    (role === 'combobox' || role === 'searchbox')
  ) {
    return null;
  }
  if (/\b(combobox|autocomplete|suggestion)\b/.test(expr)) {
    return null;
  }
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
    const expected = stripLocaleFromUrlFragment(
      step.value.slice('__url_contains__:'.length).trim()
    );
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

  const nl = `${step.intent || ''} ${step.description || ''} ${step.value || ''}`;
  const urlContains = nl.match(/\burl\s+contains\s+(.+)$/i);
  if (urlContains) {
    const expected = urlContains[1].replace(/[."']+$/g, '').trim();
    if (expected) {
      return {
        kind: 'url_contains',
        strength: 'strong',
        confidence: 0.91,
        description: `URL contains "${expected}"`,
        expected,
        source: 'intent',
        signals: ['url-contains', 'nl-derived'],
        risks: [],
      };
    }
  }

  // Brand/logo asserts: "Verify the Booking.com logo…" → brand link, not the NL sentence.
  const brandWord = nl.match(/([A-Z][a-zA-Z0-9]*\.(?:com|org|net|io))/)?.[1];
  if (brandWord && /\blogo\b/i.test(nl)) {
    return {
      kind: 'role_visible',
      strength: 'strong',
      confidence: 0.9,
      description: `${brandWord} logo link is visible`,
      expected: brandWord,
      selector: {
        kind: 'role',
        value: `link[name='${brandWord}']`,
        confidence: 0.88,
        signals: ['brand-logo', 'nl-derived'],
        risks: [],
      },
      source: 'intent',
      signals: ['brand-logo', 'nl-derived'],
      risks: [],
    };
  }

  // A grounded selector is stronger than repeating the NL value as literal page text.
  if (step.selector) return null;

  const text =
    extractAssertText(step.value) ||
    extractAssertText(step.intent || '') ||
    extractAssertText(step.description || '');
  if (!text) return null;

  // Compound page-state NL ("X and Y are visible") is not literal page text.
  if (/\band\b/i.test(text) && text.length > 40) {
    return null;
  }

  return {
    kind: 'text_visible',
    strength: 'strong',
    confidence: 0.9,
    description: `Text "${text}" is visible`,
    expected: text,
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

function semanticCandidates(step: TraceStep): AssertionCandidate[] {
  // Prefer a single text surface to avoid duplicating identical intent/description lines.
  const text = step.intent || step.description || step.value || '';
  if (!AssertionDslParser.looksLikeSemanticDsl(text) && !/^Extract\b|^Assert\b/im.test(text)) {
    return [];
  }
  const plan = AssertionDslParser.parseText(text);
  step.semanticPlan = plan;
  return plan.assertions.map((semantic, index) => ({
    kind: 'semantic' as const,
    strength: 'strong' as const,
    confidence: 0.95,
    description: semantic.description || semantic.assertionId,
    source: 'semantic' as const,
    signals: ['semantic-dsl', ...(plan.extractions.length ? ['has-extractions'] : [])],
    risks: plan.rejected.map((r) => r.reason),
    semantic,
    expected: index,
  }));
}

export class AssertionRanker {
  public static candidatesForStep(step: TraceStep, previous?: TraceStep): AssertionCandidate[] {
    const semantic = semanticCandidates(step);
    if (semantic.length) {
      return semantic;
    }

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
