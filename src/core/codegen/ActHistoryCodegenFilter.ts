import { RawExecutionStep } from './ExecutionTrace';

/**
 * Actions that are browser-use agent tools / noise — not Playwright interactions.
 * These must not become POM methods like assertCustomSearchedPageFor…204MatchesFound.
 */
const DROP_ACTIONS = new Set([
  'search_page',
  'extract',
  'evaluate',
  'find_elements',
  'find_text',
  'search',
  'switch',
  'close',
  'done',
  'custom',
  'write_file',
  'replace_file',
  'read_file',
  'append_file',
  'write_todos',
  'update_todo',
]);

const KEEP_ACTIONS = new Set([
  'navigate',
  'goto',
  'go_to',
  'open',
  'click',
  'tap',
  'input',
  'fill',
  'type',
  'enter',
  'select',
  'choose',
  'dropdown',
  'assert',
  'verify',
  'expect',
  'check',
  'assert_visible_page',
  'browser-use-assertion',
  'wait',
  'sleep',
  'pause',
  'go_back',
  'back',
  'navigate_back',
  'screenshot',
  'press',
  'keydown',
  'keypress',
  'keyboard',
  'scroll',
  'hover',
]);

function isNoiseDescription(description: string): boolean {
  const d = description.toLowerCase();
  // Agent tool leftovers that pollute codegen method names.
  // Drop all search_page residue — NL assertionPlan already carries the verifies.
  if (/searched page for/i.test(d)) return true;
  if (/^\s*custom\s*\|/i.test(d) && /match(es)? found/i.test(d)) return true;
  if (/extract\s*\|/i.test(d)) return true;
  if (/find_elements/i.test(d)) return true;
  if (/data written to file|successfully replaced all occurrences|todo\.md/i.test(d)) return true;
  return false;
}

/**
 * Keep only ActHistory steps that map cleanly to Playwright codegen.
 * Drops browser-use discovery tools (search_page, extract, evaluate, …).
 */
export function filterActHistoryForCodegen(steps: RawExecutionStep[]): {
  steps: RawExecutionStep[];
  dropped: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  const kept: RawExecutionStep[] = [];

  for (const step of steps) {
    const action = String(step.action || 'custom').trim().toLowerCase();
    const description = String(step.description || '');

    if (DROP_ACTIONS.has(action)) {
      reasons.push(`drop ${action}: ${description.slice(0, 60)}`);
      continue;
    }
    if (!KEEP_ACTIONS.has(action) && action !== 'assert') {
      // Unknown → drop unless it looks like a navigate/click with selectors.
      if (!step.selector && !step.url && !/^navigate|click|fill|input/i.test(action)) {
        reasons.push(`drop unknown ${action}: ${description.slice(0, 60)}`);
        continue;
      }
    }
    if (isNoiseDescription(description)) {
      reasons.push(`drop noise desc: ${description.slice(0, 60)}`);
      continue;
    }

    // Skip-to-main / #main anchors are accessibility chrome, not user intent.
    const selectorBlob = JSON.stringify(step.selector || step.locators || '').toLowerCase();
    if (
      /#main|skip.?to.?main|skip.?to.?content/i.test(description) ||
      /#main|skip.?to.?main/i.test(selectorBlob)
    ) {
      reasons.push(`drop skip-link: ${description.slice(0, 60)}`);
      continue;
    }

    // Pure waits longer than 5s are agent padding — keep short waits only.
    if (['wait', 'sleep', 'pause'].includes(action)) {
      const seconds = Number(step.value);
      if (Number.isFinite(seconds) && seconds > 5) {
        reasons.push(`drop long wait ${seconds}s`);
        continue;
      }
    }

    kept.push(step);
  }

  return {
    steps: kept.map((step, i) => ({ ...step, index: i + 1 })),
    dropped: steps.length - kept.length,
    reasons,
  };
}
