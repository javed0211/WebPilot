import type { Page } from 'playwright';
import type { ActLocator, ActStep } from './ActHistoryTypes';
import { stripLocaleFromUrlFragment } from '../assertions/LocaleUrl';
import { describeLocator, resolveUniqueLocator } from './LocatorResolver';

export type AssertIntent =
  | { kind: 'url_contains'; fragment: string; source: string }
  | { kind: 'url_equals'; url: string; source: string }
  | { kind: 'page_loaded'; source: string }
  | { kind: 'visible'; locators: ActLocator[]; source: string }
  | { kind: 'ungrounded'; reason: string; source: string };

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
  // "Get started link" → "Get started" (role noun is not page text)
  text = text.replace(/\s+(link|button|heading|menu|tab|checkbox|radio)$/i, '');
  text = text.replace(/[."']+$/g, '').trim();
  if (!text || text.length > 120) return null;
  return text;
}

function nlFromStep(step: ActStep): string {
  return String(step.description || step.value || '').trim();
}

/**
 * Ground an assert step into a concrete check.
 * Prefer explicit values / locators; fall back to NL patterns used by codegen.
 */
export function groundAssertStep(step: ActStep, locators: ActLocator[]): AssertIntent {
  const nl = nlFromStep(step);
  const value = String(step.value || '').trim();
  const source = nl || value || `assert#${step.index}`;

  if (value.startsWith('__url_contains__:')) {
    const fragment = stripLocaleFromUrlFragment(
      value.slice('__url_contains__:'.length).trim()
    );
    if (!fragment) {
      return { kind: 'ungrounded', reason: 'empty __url_contains__ value', source };
    }
    return { kind: 'url_contains', fragment, source };
  }

  if (value.startsWith('__url_equals__:')) {
    const url = value.slice('__url_equals__:'.length).trim();
    if (!url) {
      return { kind: 'ungrounded', reason: 'empty __url_equals__ value', source };
    }
    return { kind: 'url_equals', url, source };
  }

  const urlContains = nl.match(/\burl\s+contains\s+(.+)$/i);
  if (urlContains) {
    const fragment = urlContains[1].replace(/[."']+$/g, '').trim();
    if (fragment) return { kind: 'url_contains', fragment, source };
  }

  if (/\b(loads?\s+successfully|homepage\s+loads)\b/i.test(nl)) {
    if (step.url) return { kind: 'url_equals', url: String(step.url), source };
    return { kind: 'page_loaded', source };
  }

  if (locators.length > 0) {
    const enriched: ActLocator[] = [...locators];
    // Text-only nav/filter labels often duplicate in hidden menus; prefer role too.
    for (const loc of locators) {
      if (loc.kind === 'text' && loc.value) {
        enriched.push({ kind: 'role', value: 'link', name: loc.value, exact: false });
        enriched.push({ kind: 'role', value: 'tab', name: loc.value, exact: false });
      }
    }
    return { kind: 'visible', locators: enriched, source };
  }

  const text = extractAssertText(nl) || (value && !value.startsWith('__') ? value : null);
  if (text) {
    const grounded: ActLocator[] = [
      // Case-insensitive substring — NL casing rarely matches DOM exactly.
      { kind: 'text', value: text, exact: false },
    ];
    if (/\bheading\b/i.test(nl) || /\bpage\b/i.test(nl) || /\bsection\b/i.test(nl)) {
      grounded.unshift({ kind: 'role', value: 'heading', name: text });
    }
    if (/\blink\b/i.test(nl)) {
      grounded.unshift({ kind: 'role', value: 'link', name: text, exact: true });
    } else if (/\bbutton\b/i.test(nl)) {
      grounded.unshift({ kind: 'role', value: 'button', name: text, exact: true });
    }
    return { kind: 'visible', locators: grounded, source };
  }

  return {
    kind: 'ungrounded',
    reason: 'assert has no locators and NL could not be grounded to URL/text',
    source,
  };
}

/**
 * Execute a grounded assert against the live page.
 * Returns a short locatorUsed description on success; throws on failure.
 */
export async function executeAssertStep(
  page: Page,
  step: ActStep,
  locators: ActLocator[],
  timeoutMs: number
): Promise<string> {
  const intent = groundAssertStep(step, locators);

  if (intent.kind === 'ungrounded') {
    throw new Error(`assert ungrounded: ${intent.reason} (${intent.source})`);
  }

  if (intent.kind === 'url_contains') {
    const current = page.url();
    const normalize = (s: string) =>
      decodeURIComponent(s.replace(/\+/g, ' '))
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    const haystack = normalize(current);
    const needle = normalize(intent.fragment);
    // Also accept URL-encoded / plus-joined forms of the same phrase.
    const needleCompact = needle.replace(/\s+/g, '');
    const haystackCompact = haystack.replace(/\s+/g, '');
    const plusForm = intent.fragment.toLowerCase().replace(/\s+/g, '+');
    const encodedForm = encodeURIComponent(intent.fragment).toLowerCase();

    let matched =
      haystack.includes(needle) ||
      haystackCompact.includes(needleCompact) ||
      current.toLowerCase().includes(plusForm) ||
      current.toLowerCase().includes(encodedForm);

    // Path-like fragments (repo slugs) must appear in the pathname, not only
    // in ?q=… — otherwise search URLs falsely satisfy "on repo page" asserts.
    if (matched && needle.includes('/')) {
      try {
        const path = normalize(new URL(current).pathname);
        const pathCompact = path.replace(/\s+/g, '');
        matched =
          path.includes(needle) ||
          pathCompact.includes(needleCompact) ||
          path.includes(needle.replace(/\s+/g, '-'));
      } catch {
        matched = false;
      }
    }

    if (!matched) {
      throw new Error(
        `assert URL contains "${intent.fragment}" failed (url=${current})`
      );
    }
    return `url_contains:${intent.fragment}`;
  }

  if (intent.kind === 'url_equals') {
    const current = page.url().replace(/\/$/, '');
    const expected = intent.url.replace(/\/$/, '');
    if (current !== expected && !current.startsWith(expected)) {
      throw new Error(`assert URL equals "${intent.url}" failed (url=${page.url()})`);
    }
    return `url_equals:${intent.url}`;
  }

  if (intent.kind === 'page_loaded') {
    await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => undefined);
    const url = page.url();
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(`assert page loaded failed (url=${url})`);
    }
    const bodyText = ((await page.locator('body').innerText().catch(() => '')) || '').trim();
    if (bodyText.length < 20) {
      throw new Error(`assert page loaded failed — body empty (url=${url})`);
    }
    return `page_loaded:${url}`;
  }

  // visible
  const resolved = await resolveUniqueLocator(page, intent.locators, {
    timeoutMs: Math.min(timeoutMs, 5_000),
    allowFirst: true,
    action: 'assert',
  });
  if (!resolved) {
    const tried = intent.locators
      .slice(0, 6)
      .map((l) => describeLocator(l))
      .join(' | ');
    throw new Error(
      `assert not visible: ${intent.source}` + (tried ? ` (tried: ${tried})` : '')
    );
  }
  await resolved.locator.first().waitFor({ state: 'visible', timeout: timeoutMs });
  return resolved.description;
}
