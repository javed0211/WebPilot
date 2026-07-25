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
  'write_file',
  'replace_file',
  'read_file',
  'append_file',
  'write_todos',
  'update_todo',
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
 * Normalize a raw ActHistory step the same way for both scoring and re-insert passes.
 * Returns null when the step must be dropped (agent tools, skip-only clicks, empty inputs, …).
 */
function prepareStep(raw: ActStep): { action: string; step: ActStep } | 'drop' | 'skip-long-wait' {
  const action = normalizeAction(raw.action);
  if (NON_REPLAY_ACTIONS.has(action) || NON_REPLAY_ACTIONS.has(raw.action)) {
    return 'drop';
  }
  if (action === 'wait') {
    const seconds = Number(raw.value);
    if (Number.isFinite(seconds) && seconds > 8) {
      return 'skip-long-wait';
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
    if (!value) return 'drop';
    return { action, step };
  }

  if (action === 'click') {
    // Skip-to-main / #main clicks are agent mistakes — never replay them.
    if (stepLocators(raw).length > 0 && locators.length === 0) {
      return 'drop';
    }
    const score = scoreLocatorsForAction('click', locators);
    if (!locators.length && score < 0) {
      return 'drop';
    }
    return { action, step };
  }

  return { action, step };
}

/**
 * Compact noisy browser-use ActHistory into a replay-safe sequence.
 * - Drops agent-tool steps (search_page, extract, …)
 * - Merges duplicate input/click retries — keeps the best locator set per intent
 * - Strips skip-link / #main anchors from fill targets
 *
 * Important: scoring and re-insert must use the *same* filtered locator key, otherwise
 * clicks that also carried a skip-link candidate are silently lost (lookup miss).
 */
export function sanitizeActHistoryForReplay(steps: ActStep[]): {
  steps: ActStep[];
  dropped: number;
  merged: number;
  droppedReasons: string[];
  mergedReasons: string[];
} {
  let dropped = 0;
  let merged = 0;
  const droppedReasons: string[] = [];
  const mergedReasons: string[] = [];

  // Best scored step per input value and per click signature (filtered locators).
  const bestInputByValue = new Map<string, ActStep>();
  const bestClickBySig = new Map<string, ActStep>();

  for (const raw of steps) {
    const prepared = prepareStep(raw);
    if (prepared === 'drop' || prepared === 'skip-long-wait') {
      dropped += 1;
      droppedReasons.push(
        prepared === 'skip-long-wait'
          ? `drop long wait: ${(raw.description || raw.action || '').toString().slice(0, 80)}`
          : `drop ${normalizeAction(raw.action)}: ${(raw.description || '').toString().slice(0, 80)}`
      );
      continue;
    }
    const { action, step } = prepared;

    if (action === 'input') {
      const value = String(step.value ?? '').trim();
      // Keep value-only inputs (empty locators) so replay can use semantic destination fallback.
      const score = scoreLocatorsForAction('input', step.locators || []);
      const prev = bestInputByValue.get(value);
      if (!prev || score > scoreLocatorsForAction('input', stepLocators(prev))) {
        if (prev) {
          merged += 1;
          mergedReasons.push(`merged input value=${value.slice(0, 40)}`);
        }
        bestInputByValue.set(value, step);
      } else {
        merged += 1;
        mergedReasons.push(`merged input value=${value.slice(0, 40)}`);
      }
      continue;
    }

    if (action === 'click') {
      const sig = stepKey(step);
      const score = scoreLocatorsForAction('click', step.locators || []);
      const prev = bestClickBySig.get(sig);
      if (!prev || score > scoreLocatorsForAction('click', stepLocators(prev))) {
        if (prev) {
          merged += 1;
          mergedReasons.push(`merged click ${sig.slice(0, 60)}`);
        }
        bestClickBySig.set(sig, step);
      } else {
        merged += 1;
        mergedReasons.push(`merged click ${sig.slice(0, 60)}`);
      }
    }
  }

  // Re-insert best input/click steps in original order (first occurrence position).
  // Keys MUST match the filtered stepKey used when populating the maps above.
  const usedInput = new Set<string>();
  const usedClick = new Set<string>();
  const output: ActStep[] = [];

  for (const raw of steps) {
    const prepared = prepareStep(raw);
    if (prepared === 'drop' || prepared === 'skip-long-wait') continue;

    const { action, step } = prepared;

    if (action === 'input') {
      const value = String(step.value ?? '').trim();
      if (!value || usedInput.has(value)) continue;
      const best = bestInputByValue.get(value);
      if (best) {
        output.push(best);
        usedInput.add(value);
      }
      continue;
    }

    if (action === 'click') {
      const sig = stepKey(step);
      if (usedClick.has(sig)) continue;
      const best = bestClickBySig.get(sig);
      if (best) {
        output.push(best);
        usedClick.add(sig);
      }
      continue;
    }

    // navigate, press, go_back, scroll, wait, etc. — include once per identical key
    const key = stepKey(step);
    if (output.some((s) => stepKey(s) === key && normalizeAction(s.action) === action)) {
      merged += 1;
      mergedReasons.push(`merged ${action} ${key.slice(0, 60)}`);
      continue;
    }
    output.push(step);
  }

  return {
    steps: output.map((step, i) => ({ ...step, index: i + 1 })),
    dropped,
    merged,
    droppedReasons,
    mergedReasons,
  };
}
