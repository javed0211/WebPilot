import type { Locator, Page } from 'playwright';
import type { ActLocator } from './ActHistoryTypes';
import { isBadInputLocator } from './ActHistorySanitizer';

const KIND_PRIORITY: Record<string, number> = {
  role: 0,
  label: 1,
  placeholder: 2,
  testid: 3,
  text: 4,
  css: 5,
  xpath: 6,
};

export function parseLocatorsFromSelectorJson(selector?: string | null): ActLocator[] {
  if (!selector || !selector.trim().startsWith('[')) return [];
  try {
    const parsed = JSON.parse(selector);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === 'object') as ActLocator[];
  } catch {
    return [];
  }
}

export function rankLocators(locators: ActLocator[]): ActLocator[] {
  return [...locators].sort(
    (a, b) => (KIND_PRIORITY[a.kind] ?? 99) - (KIND_PRIORITY[b.kind] ?? 99)
  );
}

export function describeLocator(locator: ActLocator): string {
  let base = '';
  if (locator.kind === 'role') {
    base = locator.name
      ? `getByRole('${locator.value}', { name: '${locator.name}' })`
      : `getByRole('${locator.value}')`;
  } else if (locator.kind === 'label') {
    base = `getByLabel('${locator.value}')`;
  } else if (locator.kind === 'placeholder') {
    base = `getByPlaceholder('${locator.value}')`;
  } else if (locator.kind === 'testid') {
    base = `getByTestId('${locator.value}')`;
  } else if (locator.kind === 'text') {
    base = `getByText('${locator.value}')`;
  } else if (locator.kind === 'xpath') {
    base = `locator('xpath=${locator.value}')`;
  } else {
    base = `locator('${locator.value}')`;
  }
  if (locator.filterText && locator.kind !== 'role' && locator.kind !== 'text') {
    return `${base}.filter({ hasText: '${locator.filterText}' })`;
  }
  return base;
}

/** Bind an ActLocator candidate to a Playwright Locator (semantic when applicable). */
export function bindLocator(page: Page, locator: ActLocator): Locator | null {
  const kind = String(locator.kind || '').toLowerCase();
  const value = locator.value ?? '';
  const name = locator.name;

  try {
    let bound: Locator | null = null;
    if (kind === 'role' && value) {
      bound = name
        ? page.getByRole(value as Parameters<Page['getByRole']>[0], {
            name,
            exact: /[/.]/.test(name),
          })
        : page.getByRole(value as Parameters<Page['getByRole']>[0]);
    } else if (kind === 'label' && value) {
      bound = page.getByLabel(value);
    } else if (kind === 'placeholder' && value) {
      bound = page.getByPlaceholder(value);
    } else if (kind === 'testid' && value) {
      bound = page.getByTestId(value);
    } else if (kind === 'text' && value) {
      bound = page.getByText(value, { exact: false });
    } else if (kind === 'xpath' && value) {
      const xp = value.startsWith('xpath=') ? value : `xpath=${value}`;
      bound = page.locator(xp);
    } else if ((kind === 'css' || kind === 'unknown' || !kind) && value) {
      bound = page.locator(value);
    }
    if (!bound) return null;
    return applyLocatorFilter(bound, locator);
  } catch {
    return null;
  }
}

/** Narrow ambiguous matches using filterText / name when present. */
export function applyLocatorFilter(bound: Locator, locator: ActLocator): Locator {
  const filterText = (locator.filterText || (locator.kind !== 'role' ? locator.name : undefined) || '').trim();
  if (!filterText) return bound;
  // Role+name already scopes by accessible name; extra filter only for other kinds.
  if (locator.kind === 'role' && locator.name) return bound;
  if (locator.kind === 'text') return bound;
  return bound.filter({ hasText: filterText });
}

/**
 * When a candidate matches multiple nodes, try sibling semantic hints from the
 * same step (text / role name / filterText) before giving up.
 */
export function disambiguateWithHints(
  bound: Locator,
  candidate: ActLocator,
  allLocators: ActLocator[]
): Locator {
  let current = applyLocatorFilter(bound, candidate);
  const hints = [
    candidate.filterText,
    candidate.name,
    ...allLocators.map((l) => l.filterText || l.name || (l.kind === 'text' ? l.value : undefined)),
  ]
    .map((h) => (h || '').trim())
    .filter(Boolean);

  const seen = new Set<string>();
  for (const hint of hints) {
    if (seen.has(hint)) continue;
    seen.add(hint);
    current = current.filter({ hasText: hint });
  }
  return current;
}

export function filterLocatorsForAction(action: string, locators: ActLocator[]): ActLocator[] {
  const normalized = action === 'fill' || action === 'type' ? 'input' : action;
  const withoutSkip = locators.filter((loc) => {
    const blob = `${loc.kind || ''}:${loc.value || ''}:${loc.name || ''}`.toLowerCase();
    return !/#main|skip to main|skip to content/.test(blob);
  });
  if (normalized !== 'input') return withoutSkip;
  const good = withoutSkip.filter((loc) => !isBadInputLocator(loc));
  return good;
}

export async function resolveUniqueLocator(
  page: Page,
  locators: ActLocator[],
  options?: { timeoutMs?: number; allowFirst?: boolean; action?: string }
): Promise<{ locator: Locator; used: ActLocator; description: string } | null> {
  const ranked = rankLocators(
    options?.action ? filterLocatorsForAction(options.action, locators) : locators
  );
  const timeout = options?.timeoutMs ?? 5_000;

  for (const candidate of ranked) {
    const bound = bindLocator(page, candidate);
    if (!bound) continue;
    try {
      let target = bound;
      let count = await target.count();
      if (count < 1) continue;

      if (count > 1) {
        const filtered = disambiguateWithHints(bound, candidate, ranked);
        const filteredCount = await filtered.count();
        if (filteredCount === 1) {
          target = filtered;
          count = 1;
        } else if (filteredCount > 1 && options?.allowFirst) {
          target = filtered.first();
          count = 1;
        } else if (!options?.allowFirst) {
          // Prefer strict uniqueness; try next candidate.
          continue;
        } else {
          target = target.first();
        }
      }

      await target.waitFor({ state: 'visible', timeout });
      return {
        locator: target,
        used: candidate,
        description: describeLocator(candidate),
      };
    } catch {
      // try next candidate
    }
  }

  // Last resort: first-match on any visible candidate (with filters applied).
  for (const candidate of ranked) {
    const bound = bindLocator(page, candidate);
    if (!bound) continue;
    try {
      const filtered = disambiguateWithHints(bound, candidate, ranked);
      const first = filtered.first();
      await first.waitFor({ state: 'visible', timeout: Math.min(timeout, 2_000) });
      return {
        locator: first,
        used: candidate,
        description: `${describeLocator(candidate)}.first()`,
      };
    } catch {
      // continue
    }
  }

  return null;
}

/** Parse a healed Playwright-ish selector string into a Locator. */
export function bindHealedSelector(page: Page, healed: string): Locator {
  const trimmed = healed.trim();
  if (trimmed.startsWith('getByRole(') || trimmed.startsWith('page.getByRole(')) {
    // Fall through to evaluate via page.locator with css if complex; simple cases handled below.
  }
  const roleMatch = trimmed.match(
    /getByRole\(\s*['"]([^'"]+)['"]\s*(?:,\s*\{\s*name:\s*['"]([^'"]*)['"][^}]*\})?/
  );
  if (roleMatch) {
    return roleMatch[2]
      ? page.getByRole(roleMatch[1] as Parameters<Page['getByRole']>[0], { name: roleMatch[2] })
      : page.getByRole(roleMatch[1] as Parameters<Page['getByRole']>[0]);
  }
  const labelMatch = trimmed.match(/getByLabel\(\s*['"]([^'"]+)['"]/);
  if (labelMatch) return page.getByLabel(labelMatch[1]);
  const phMatch = trimmed.match(/getByPlaceholder\(\s*['"]([^'"]+)['"]/);
  if (phMatch) return page.getByPlaceholder(phMatch[1]);
  const tidMatch = trimmed.match(/getByTestId\(\s*['"]([^'"]+)['"]/);
  if (tidMatch) return page.getByTestId(tidMatch[1]);
  const textMatch = trimmed.match(/getByText\(\s*['"]([^'"]+)['"]/);
  if (textMatch) return page.getByText(textMatch[1]);
  const locMatch = trimmed.match(/locator\(\s*['"]([^'"]+)['"]/);
  if (locMatch) return page.locator(locMatch[1]);
  return page.locator(trimmed);
}
