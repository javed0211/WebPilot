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
  if (['assert', 'verify', 'expect', 'check'].includes(action)) return 'assert';
  if (['wait', 'sleep', 'pause'].includes(action)) return 'wait';
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

function parseSelector(raw?: string | null, url?: string, intent?: string): TraceSelector | undefined {
  if (!raw || !raw.trim()) return undefined;
  const selector = raw.trim();
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

      normalized.push({
        index: step.index ?? index + 1,
        intent,
        action,
        selector: parseSelector(step.selector, step.url || currentUrl, intent),
        url: step.url || currentUrl,
        value: step.value || undefined,
        description: step.description,
        pageCandidate: currentUrl,
      });
    }

    for (const [index, step] of normalized.entries()) {
      step.assertions = AssertionRanker.candidatesForStep(step, normalized[index - 1]);
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
