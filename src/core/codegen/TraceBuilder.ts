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
import { HealingAgent } from '../../agents/HealingAgent';
import { ConfigManager } from '../ConfigManager';
import * as path from 'path';
import { AssertionRanker } from '../assertions/AssertionRanker';
import { extractStepSubject } from './ParameterizedMethodBinder';

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
  if (['press', 'keydown', 'keypress', 'keyboard'].includes(action)) return 'press';
  if (['click', 'tap'].includes(action)) return 'click';
  if (['input', 'fill', 'type', 'enter'].includes(action)) return 'fill';
  if (['select', 'choose', 'dropdown'].includes(action)) return 'select';
  if (['assert', 'verify', 'expect', 'check', 'assert_visible_page', 'browser-use-assertion'].includes(action))
    return 'assert';
  // search_page is a browser-use tool — never treat as Playwright assert (becomes noise methods).
  if (action === 'search_page') return 'custom';
  if (['wait', 'sleep', 'pause'].includes(action)) return 'wait';
  if (['go_back', 'back', 'navigate_back'].includes(action)) return 'go_back';
  if (['screenshot', 'capture_screenshot', 'take_screenshot'].includes(action)) return 'screenshot';
  return 'custom';
}

function keyFromIntent(intent: string, value?: string): string | undefined {
  if (value) return value;
  const match = intent.match(
    /\bpress\s+(enter|escape|tab|backspace|delete|space|arrow(?:up|down|left|right))\b/i
  );
  if (match) {
    const key = match[1].toLowerCase();
    if (key === 'space') return ' ';
    return key.charAt(0).toUpperCase() + key.slice(1);
  }
  if (/^enter$/i.test(intent.trim())) return 'Enter';
  return undefined;
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

    // Prefer DOM-verified inventory locators over heuristic SelectorRanker picks.
    const ordered = [
      ...parsed.filter((l: { verified?: boolean }) => l && l.verified),
      ...parsed.filter((l: { verified?: boolean }) => l && !l.verified),
    ];

    const candidates: SelectorCandidate[] = [];
    for (const locator of ordered) {
      if (!locator || typeof locator !== 'object') continue;
      const kind = String(locator.kind || 'unknown');
      const value = String(locator.value || '');
      const name = typeof locator.name === 'string' ? locator.name : undefined;
      const exact = locator.exact !== false && Boolean(name);
      let expression = '';

      if (kind === 'role') {
        expression = name
          ? `getByRole('${value.replace(/'/g, "\\'")}', { name: '${name.replace(/'/g, "\\'")}'${exact ? ', exact: true' : ''} })`
          : `getByRole('${value.replace(/'/g, "\\'")}')`;
        // Scope: page.locator(nav).getByRole(...)
        if (locator.scope?.kind === 'css' && locator.scope?.value) {
          expression = `locator('${String(locator.scope.value).replace(/'/g, "\\'")}')` + `.${expression}`;
        } else if (locator.scope?.kind === 'role' && locator.scope?.value) {
          expression =
            `getByRole('${String(locator.scope.value).replace(/'/g, "\\'")}')` + `.${expression}`;
        }
        const cand = SelectorRanker.candidate(
          'role',
          name ? `${value}[name='${name}']` : value,
          expression
        );
        if (locator.verified) cand.confidence = 0.99;
        candidates.push(cand);
        continue;
      }
      if (kind === 'label') {
        expression = `getByLabel('${value.replace(/'/g, "\\'")}')`;
      } else if (kind === 'placeholder') {
        expression = `getByPlaceholder('${value.replace(/'/g, "\\'")}')`;
      } else if (kind === 'testid') {
        expression = `getByTestId('${value.replace(/'/g, "\\'")}')`;
      } else if (kind === 'text') {
        expression = `getByText('${value.replace(/'/g, "\\'")}'${exact ? ', { exact: true }' : ''})`;
      } else if (kind === 'css' || kind === 'xpath') {
        expression = `locator('${value.replace(/'/g, "\\'")}')`;
      }
      const cand = SelectorRanker.candidate(kind as SelectorKind, value, expression || undefined);
      if (locator.verified) cand.confidence = 0.99;
      candidates.push(cand);
    }

    // If any verified, pick first verified (already ordered); else SelectorRanker.
    const verifiedCand = candidates.find((c) => c.confidence >= 0.99);
    if (verifiedCand) {
      const rest = candidates.filter((c) => c !== verifiedCand);
      return toTraceSelector(verifiedCand, rest.slice(0, 3));
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
  let selector = raw.trim();

  // Prefer previously healed selectors so codegen doesn't re-emit broken locators.
  try {
    const cachePath = ConfigManager.getInstance().get(
      'framework.healingCachePath',
      path.join(process.cwd(), 'runtime', 'healing-cache', 'cache.json')
    );
    const healed = HealingAgent.lookupCache(selector, cachePath);
    if (healed && healed.trim()) {
      selector = healed.trim();
    }
  } catch {
    /* ignore cache miss / config */
  }

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

function humanizeLocatorName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 60);
}

function conciseDescription(description: string, action: string): string {
  const firstLine = description.split('\n')[0].trim();
  const pipeParts = firstLine.split('|').map((part) => part.trim()).filter(Boolean);
  // browser-use descriptions are commonly "action | target | outcome". The
  // outcome is execution telemetry, not method-name intent.
  if (pipeParts.length >= 2) return pipeParts[1].slice(0, 80);
  return firstLine
    .replace(/\b(clicked|typed|selected|navigated|waited)\b[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, action === 'assert' ? 110 : 80);
}

/** Derive a human-meaningful target from locator candidates (role name > text > label). */
function semanticTargetFromStep(step: RawExecutionStep): string | undefined {
  const locators = step.locators || [];
  const parsed: Array<{ kind: string; value?: string; name?: string }> = locators.length
    ? locators
    : (() => {
        try {
          const raw = step.selector?.trim();
          if (raw && raw.startsWith('[')) return JSON.parse(raw);
        } catch {
          /* ignore */
        }
        return [];
      })();

  for (const loc of parsed) {
    if (loc.kind === 'role' && loc.name) {
      return humanizeLocatorName(`${loc.name} ${loc.value || ''}`.trim());
    }
  }
  for (const loc of parsed) {
    if ((loc.kind === 'text' || loc.kind === 'label' || loc.kind === 'placeholder') && loc.value) {
      return humanizeLocatorName(loc.value);
    }
  }
  for (const loc of parsed) {
    if (loc.name) return humanizeLocatorName(loc.name);
  }
  return undefined;
}

function stepIntent(step: RawExecutionStep, semanticTarget?: string): string {
  const description = step.description?.trim();
  const action = step.action?.toLowerCase() || 'step';
  // Locator-derived semantics are more stable than browser-use outcome prose.
  if (semanticTarget) {
    if (action === 'input' || action === 'fill' || action === 'type') {
      return `fill ${semanticTarget}`;
    }
    if (action === 'click' || action === 'tap') return `click ${semanticTarget}`;
    if (['assert', 'verify', 'expect', 'check'].includes(action)) return `assert ${semanticTarget}`;
    if (action === 'screenshot') return `capture ${semanticTarget}`;
    return `${action} ${semanticTarget}`;
  }
  if (action === 'navigate' && step.url) {
    try {
      const parsed = new URL(step.url);
      return `navigate to ${parsed.origin}${parsed.pathname}`;
    } catch {
      return `navigate to ${step.url.slice(0, 80)}`;
    }
  }
  if ((action === 'input' || action === 'fill') && step.value) return `enter ${step.value}`;
  if (action === 'wait') return 'wait for page';
  if (action === 'screenshot') return 'capture page screenshot';
  if (['assert', 'verify', 'expect', 'check'].includes(action) && description) {
    const assertionIntent = conciseDescription(description, 'assert')
      .replace(/^(verify|assert|check|ensure)\s+/i, '')
      .replace(/\s+(is|are)\s+(visible|displayed|shown|present|loaded).*$/i, '')
      .replace(/^the\s+/i, '')
      .trim();
    return assertionIntent ? `assert ${assertionIntent}` : 'assert page state';
  }
  if (description) return conciseDescription(description, action) || action;
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
      const urlBefore = step.urlBefore || currentUrl;
      // Only navigational / interaction URLs advance the active page cursor.
      // Assert steps often carry a home urlHint that would otherwise reset context
      // for every subsequent verify (mapping article asserts onto the homepage).
      if (step.url && action !== 'assert' && action !== 'screenshot') {
        currentUrl = step.url;
      }
      if (action === 'navigate' && step.url) currentUrl = step.url;

      const semanticTarget = semanticTargetFromStep(step);
      const intent = stepIntent(step, semanticTarget);
      // Do not inherit page URL onto asserts/screenshots — inherited URLs create noisy
      // toHaveURL assertions that swamp explicit text checks from NL verify steps.
      const stepUrl =
        step.url ||
        (action === 'assert' || action === 'screenshot' || action === 'go_back' ? undefined : currentUrl);

      let selectorRaw = step.selector;
      if ((!selectorRaw || selectorRaw === 'null') && step.locators?.length) {
        selectorRaw = JSON.stringify(step.locators);
      }

      let value =
        action === 'press'
          ? keyFromIntent(intent, step.value || undefined) || 'Enter'
          : step.value || undefined;
      // Assert/screenshot steps from NL often have the subject only in free text.
      // Backfill value so parameterized POM reuse can bind method(arg).
      if ((action === 'assert' || action === 'screenshot') && !value) {
        const subject = extractStepSubject({
          index: step.index ?? index + 1,
          intent,
          action,
          description: step.description,
          semanticTarget,
        });
        if (subject) value = subject;
      }

      normalized.push({
        index: step.index ?? index + 1,
        intent,
        action,
        selector: parseSelector(selectorRaw, stepUrl || currentUrl, intent),
        url: stepUrl,
        value,
        description: step.description,
        pageCandidate: currentUrl,
        urlBefore,
        urlAfter: step.urlAfter || undefined,
        semanticTarget,
        optional: Boolean((step as RawExecutionStep).optional),
      });
    }

    // Backfill urlAfter from the next step's page state so page mapping can use
    // "where did this action land" even when the runner didn't record it.
    for (let i = 0; i < normalized.length; i++) {
      if (!normalized[i].urlAfter) {
        const next = normalized[i + 1];
        normalized[i].urlAfter = next?.urlBefore || next?.url || normalized[i].pageCandidate;
      }
    }

    for (const [index, step] of normalized.entries()) {
      if (step.action === 'go_back' || step.action === 'screenshot' || step.action === 'press') {
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
