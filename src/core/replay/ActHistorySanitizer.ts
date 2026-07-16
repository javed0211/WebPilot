import type { ActLocator, ActStep } from './ActHistoryTypes';

const NON_REPLAY_ACTIONS = new Set([
  'search_page',
  'extract',
  'evaluate',
  'find_elements',
  'find_text',
  'search',
  'done',
  'custom',
]);

const SKIP_LINK_PATTERNS = [
  '#main',
  'skip to main',
  'skip to content',
  'skip to main content',
];

function normalizeAction(action: string): string {
  const a = (action || 'custom').toLowerCase();
  if (a === 'fill' || a === 'type') return 'input';
  return a;
}

function locatorText(loc: ActLocator): string {
  return `${loc.kind || ''}:${loc.value || ''}:${loc.name || ''}`.toLowerCase();
}

export function isBadInputLocator(loc: ActLocator): boolean {
  const blob = locatorText(loc);
  if (SKIP_LINK_PATTERNS.some((p) => blob.includes(p))) return true;
  if (loc.kind === 'role' && loc.value === 'link') return true;
  if (loc.kind === 'css' && /a\[href/i.test(loc.value || '') && /#main|skip/i.test(loc.value || '')) {
    return true;
  }
  return false;
}

/** Accessibility skip links — never useful as click or fill targets for replay. */
export function isSkipLinkLocator(loc: ActLocator): boolean {
  const blob = locatorText(loc);
  if (SKIP_LINK_PATTERNS.some((p) => blob.includes(p))) return true;
  if (loc.kind === 'css' && /a\[href/i.test(loc.value || '') && /#main|skip/i.test(loc.value || '')) {
    return true;
  }
  if (loc.kind === 'text' && /skip to (main|content)/i.test(loc.value || loc.name || '')) return true;
  return false;
}

export function scoreLocatorsForAction(action: string, locators: ActLocator[]): number {
  if (!locators.length) return -50;
  let best = -50;
  for (const loc of locators) {
    if (isSkipLinkLocator(loc)) continue;
    if (action === 'input' && isBadInputLocator(loc)) continue;
    let score = 0;
    const kind = String(loc.kind || '').toLowerCase();
    if (action === 'input') {
      if (kind === 'role' && ['combobox', 'textbox', 'searchbox'].includes(loc.value || '')) score += 25;
      if (kind === 'placeholder') score += 18;
      if (kind === 'label') score += 15;
      if (kind === 'testid') score += 12;
      if (kind === 'css' && /input|textarea|select/i.test(loc.value || '')) score += 10;
      if (kind === 'role' && loc.value === 'button') score -= 5;
    } else if (action === 'click') {
      if (kind === 'role' && ['button', 'link', 'option', 'tab'].includes(loc.value || '')) score += 15;
      if (kind === 'css' && /onetrust-accept|fc-cta-consent/i.test(loc.value || '')) score += 20;
      if (kind === 'text') score += 8;
    } else {
      if (kind === 'role') score += 10;
    }
    if (loc.name || loc.filterText) score += 3;
    best = Math.max(best, score);
  }
  return best;
}

function stepLocators(step: ActStep): ActLocator[] {
  if (Array.isArray(step.locators) && step.locators.length) return step.locators;
  if (step.selector && step.selector.trim().startsWith('[')) {
    try {
      return JSON.parse(step.selector) as ActLocator[];
    } catch {
      return [];
    }
  }
  return [];
}

function filterLocatorsForAction(action: string, locators: ActLocator[]): ActLocator[] {
  const withoutSkip = locators.filter((loc) => !isSkipLinkLocator(loc));
  if (action === 'input') {
    const good = withoutSkip.filter((loc) => !isBadInputLocator(loc));
    // Prefer empty over bad anchors so replay can use semantic destination fallback.
    return good;
  }
  return withoutSkip;
}

function stepKey(step: ActStep): string {
  const action = normalizeAction(step.action);
  const value = String(step.value ?? '').trim();
  const locs = stepLocators(step)
    .map(locatorText)
    .sort()
    .join('|');
  return `${action}::${value}::${locs}`;
}

/**
 * Compact noisy browser-use ActHistory into a replay-safe sequence.
 * - Drops agent-tool steps (search_page, extract, …)
 * - Merges duplicate input/click retries — keeps the best locator set per intent
 * - Strips skip-link / #main anchors from fill targets
 */
export function sanitizeActHistoryForReplay(steps: ActStep[]): {
  steps: ActStep[];
  dropped: number;
  merged: number;
} {
  const kept: ActStep[] = [];
  let dropped = 0;
  let merged = 0;

  // Best scored step per input value and per click signature.
  const bestInputByValue = new Map<string, ActStep>();
  const bestClickBySig = new Map<string, ActStep>();

  for (const raw of steps) {
    const action = normalizeAction(raw.action);
    if (NON_REPLAY_ACTIONS.has(action) || NON_REPLAY_ACTIONS.has(raw.action)) {
      dropped += 1;
      continue;
    }
    if (action === 'wait') {
      const seconds = Number(raw.value);
      if (Number.isFinite(seconds) && seconds > 8) {
        dropped += 1;
        continue;
      }
    }

    const locators = filterLocatorsForAction(action, stepLocators(raw));
    const step: ActStep = {
      ...raw,
      locators,
      selector: locators.length ? JSON.stringify(locators) : undefined,
    };

    if (action === 'input') {
      const value = String(step.value ?? '').trim();
      if (!value) {
        dropped += 1;
        continue;
      }
      // Keep value-only inputs (empty locators) so replay can use semantic destination fallback.
      const score = scoreLocatorsForAction('input', locators);
      const prev = bestInputByValue.get(value);
      if (!prev || score > scoreLocatorsForAction('input', stepLocators(prev))) {
        bestInputByValue.set(value, step);
      } else {
        merged += 1;
      }
      continue;
    }

    if (action === 'click') {
      // Skip-to-main / #main clicks are agent mistakes — never replay them.
      if (stepLocators(raw).length > 0 && locators.length === 0) {
        dropped += 1;
        continue;
      }
      const sig = stepKey(step);
      const score = scoreLocatorsForAction('click', locators);
      if (!locators.length && score < 0) {
        dropped += 1;
        continue;
      }
      const prev = bestClickBySig.get(sig);
      if (!prev || score > scoreLocatorsForAction('click', stepLocators(prev))) {
        bestClickBySig.set(sig, step);
      } else {
        merged += 1;
      }
      continue;
    }

    kept.push(step);
  }

  // Re-insert best input/click steps in original order (first occurrence position).
  const usedInput = new Set<string>();
  const usedClick = new Set<string>();
  const output: ActStep[] = [];

  for (const raw of steps) {
    const action = normalizeAction(raw.action);
    if (NON_REPLAY_ACTIONS.has(action) || NON_REPLAY_ACTIONS.has(raw.action)) continue;

    if (action === 'input') {
      const value = String(raw.value ?? '').trim();
      if (!value || usedInput.has(value)) continue;
      const best = bestInputByValue.get(value);
      if (best) {
        output.push(best);
        usedInput.add(value);
      }
      continue;
    }

    if (action === 'click') {
      const sig = stepKey(raw);
      if (usedClick.has(sig)) continue;
      const best = bestClickBySig.get(sig);
      if (best) {
        output.push(best);
        usedClick.add(sig);
      }
      continue;
    }

    if (action === 'wait') {
      const seconds = Number(raw.value);
      if (Number.isFinite(seconds) && seconds > 8) continue;
    }

    // navigate, press, go_back, etc. — include once per identical key
    const key = stepKey(raw);
    if (output.some((s) => stepKey(s) === key && normalizeAction(s.action) === action)) {
      merged += 1;
      continue;
    }
    const locators = filterLocatorsForAction(action, stepLocators(raw));
    output.push({
      ...raw,
      locators,
      selector: locators.length ? JSON.stringify(locators) : undefined,
    });
  }

  return {
    steps: output.map((step, i) => ({ ...step, index: i + 1 })),
    dropped,
    merged,
  };
}
