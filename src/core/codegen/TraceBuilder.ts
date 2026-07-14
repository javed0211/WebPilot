import {
  ExecutionTrace,
  RawExecutionStep,
  SelectorKind,
  TraceAction,
  TraceSelector,
  TraceStep,
} from './ExecutionTrace';
import { SelectorRanker } from '../selectors/SelectorRanker';
import { SelectorCandidate } from '../selectors/SelectorCandidate';
import { SelectorRegistry } from '../selectors/SelectorRegistry';
import { AssertionRanker } from '../assertions/AssertionRanker';

const TRACE_VERSION = '1.0.0';

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeAction(raw: string): TraceAction {
  const action = raw.trim().toLowerCase();
  if (['navigate', 'goto', 'go_to', 'open'].includes(action)) return 'navigate';
  if (['click', 'tap', 'press'].includes(action)) return 'click';
  if (['input', 'fill', 'type', 'enter'].includes(action)) return 'fill';
  if (['select', 'choose', 'dropdown'].includes(action)) return 'select';
  if (['assert', 'verify', 'expect', 'check', 'assert_visible_page', 'browser-use-assertion', 'search_page'].includes(action))
    return 'assert';
  if (['wait', 'sleep', 'pause'].includes(action)) return 'wait';
  if (['go_back', 'back', 'navigate_back'].includes(action)) return 'go_back';
  if (['screenshot', 'capture_screenshot', 'take_screenshot'].includes(action)) return 'screenshot';
  return 'custom';
}

function toTraceSelector(candidate: SelectorCandidate, fallbacks: SelectorCandidate[] = []): TraceSelector {
  return {
    kind: candidate.kind as SelectorKind,
    value: candidate.value,
    expression: candidate.frameworkExpression,
    confidence: candidate.confidence,
    signals: candidate.signals,
    risks: candidate.risks,
    fallbacks: fallbacks.map((fallback) => ({
      kind: fallback.kind as SelectorKind,
      value: fallback.value,
      expression: fallback.frameworkExpression,
      confidence: fallback.confidence,
      signals: fallback.signals,
      risks: fallback.risks,
    })),
  };
}

function locatorExpressionFromJson(raw: string): TraceSelector | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;

    const candidates: SelectorCandidate[] = [];
    for (const locator of parsed) {
      if (!locator || typeof locator !== 'object') continue;
      const kind = String(locator.kind || 'unknown');
      const value = String(locator.value || '');
      const name = typeof locator.name === 'string' ? locator.name : undefined;
      let expression = '';

      if (kind === 'role') {
        expression = name
          ? `getByRole('${value.replace(/'/g, "\\'")}', { name: '${name.replace(/'/g, "\\'")}' })`
          : `getByRole('${value.replace(/'/g, "\\'")}')`;
        candidates.push(
          SelectorRanker.candidate('role', name ? `${value}[name='${name}']` : value, expression)
        );
        continue;
      }
      if (kind === 'label') {
        expression = `getByLabel('${value.replace(/'/g, "\\'")}')`;
      } else if (kind === 'placeholder') {
        expression = `getByPlaceholder('${value.replace(/'/g, "\\'")}')`;
      } else if (kind === 'testid') {
        expression = `getByTestId('${value.replace(/'/g, "\\'")}')`;
      } else if (kind === 'text') {
        expression = `getByText('${value.replace(/'/g, "\\'")}')`;
      } else if (kind === 'css' || kind === 'xpath') {
        expression = `locator('${value.replace(/'/g, "\\'")}')`;
      }
      candidates.push(SelectorRanker.candidate(kind as SelectorKind, value, expression || undefined));
    }

    const ranked = SelectorRanker.rank(candidates);
    if (!ranked) return undefined;
    return toTraceSelector(ranked.primary, ranked.fallbacks);
  } catch {
    return undefined;
  }
}

function parseSelector(raw?: string | null, url?: string, intent?: string): TraceSelector | undefined {
  if (!raw || !raw.trim()) return undefined;
  const selector = raw.trim();
  if (selector.startsWith('[')) {
    const fromJson = locatorExpressionFromJson(selector);
    if (fromJson) return fromJson;
  }
  const candidates: SelectorCandidate[] = [];

  const roleMatch = selector.match(/getByRole\(\s*['"]([^'"]+)['"]/i);
  if (roleMatch) {
    const nameMatch = selector.match(/name:\s*['"]([^'"]+)['"]/i);
    const value = nameMatch
      ? `${roleMatch[1]}[name='${nameMatch[1]}']`
      : roleMatch[1];
    candidates.push(SelectorRanker.candidate('role', value, selector));
  }

  const labelMatch = selector.match(/getByLabel\(\s*['"]([^'"]+)['"]/i);
  if (labelMatch) {
    candidates.push(SelectorRanker.candidate('label', labelMatch[1], selector));
  }

  const placeholderMatch = selector.match(/getByPlaceholder\(\s*['"]([^'"]+)['"]/i);
  if (placeholderMatch) {
    candidates.push(SelectorRanker.candidate('placeholder', placeholderMatch[1], selector));
  }

  const testIdMatch = selector.match(/getByTestId\(\s*['"]([^'"]+)['"]/i);
  if (testIdMatch) {
    candidates.push(SelectorRanker.candidate('testid', testIdMatch[1], selector));
  }

  const textMatch = selector.match(/getByText\(\s*['"]([^'"]+)['"]/i);
  if (textMatch) {
    candidates.push(SelectorRanker.candidate('text', textMatch[1], selector));
  }

  if (candidates.length === 0 && (selector.startsWith('//') || selector.startsWith('xpath='))) {
    candidates.push(SelectorRanker.candidate('xpath', selector.replace(/^xpath=/, '')));
  }

  if (
    candidates.length === 0 &&
    (/^[#.[]/.test(selector) || selector.includes('>') || selector.includes('nth-') || selector.includes(':has-text'))
  ) {
    candidates.push(SelectorRanker.candidate('css', selector));
  }

  if (candidates.length === 0) {
    candidates.push(SelectorRanker.candidate('unknown', selector));
  }

  const registryEntry = SelectorRegistry.get(url, intent || selector);
  if (registryEntry) {
    candidates.push(registryEntry.primary, ...registryEntry.fallbacks);
  }

  const ranked = SelectorRanker.rank(candidates);
  if (!ranked) return undefined;
  SelectorRegistry.record(url, intent || selector, ranked);
  return toTraceSelector(ranked.primary, ranked.fallbacks);
}

function stepIntent(step: RawExecutionStep): string {
  const description = step.description?.trim();
  if (description && description.length < 120) return description;
  if (step.url) return `navigate to ${step.url}`;
  if (step.selector && step.value) return `fill ${step.selector}`;
  if (step.selector) return `${step.action} ${step.selector}`;
  return step.action;
}

export class TraceBuilder {
  public static build(input: {
    scenario: string;
    scenarioSlug?: string;
    sourceFile?: string;
    steps: RawExecutionStep[];
    targetUrl?: string;
  }): ExecutionTrace {
    const scenarioSlug = input.scenarioSlug || slugify(input.scenario);
    const normalized: TraceStep[] = [];
    let currentUrl = input.targetUrl;

    for (const [index, step] of input.steps.entries()) {
      const action = normalizeAction(step.action);
      if (step.url) currentUrl = step.url;
      if (action === 'navigate' && step.url) currentUrl = step.url;

      const intent = stepIntent(step);
      // Do not inherit page URL onto asserts/screenshots — inherited URLs create noisy
      // toHaveURL assertions that swamp explicit text checks from NL verify steps.
      const stepUrl =
        step.url ||
        (action === 'assert' || action === 'screenshot' || action === 'go_back' ? undefined : currentUrl);

      normalized.push({
        index: step.index ?? index + 1,
        intent,
        action,
        selector: parseSelector(step.selector, stepUrl || currentUrl, intent),
        url: stepUrl,
        value: step.value || undefined,
        description: step.description,
        pageCandidate: currentUrl,
      });
    }

    for (const [index, step] of normalized.entries()) {
      if (step.action === 'go_back' || step.action === 'screenshot') {
        step.assertions = [];
        continue;
      }
      let assertions = AssertionRanker.candidatesForStep(step, normalized[index - 1]);
      // Click/fill should not inherit navigational URL asserts from pageCandidate.
      if (step.action === 'click' || step.action === 'fill' || step.action === 'select') {
        assertions = assertions.filter((assertion) => !String(assertion.kind).startsWith('url_'));
      }
      step.assertions = assertions;
    }

    const firstNavigate = normalized.find((step) => step.action === 'navigate' && step.url);

    return {
      version: TRACE_VERSION,
      scenario: input.scenario,
      scenarioSlug,
      sourceFile: input.sourceFile,
      targetUrl: input.targetUrl || firstNavigate?.url,
      generatedAt: new Date().toISOString(),
      steps: normalized,
    };
  }
}
