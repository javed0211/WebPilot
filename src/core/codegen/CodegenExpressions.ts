import { TraceSelector, TraceStep } from './ExecutionTrace';
import { AssertionEmitter } from '../assertions/AssertionEmitter';

export function escapeTsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function locatorExpression(selector: TraceSelector | undefined, receiver = 'page'): string | null {
  if (!selector) return null;

  if (selector.expression) {
    let expr = selector.expression.trim();
    if (expr.startsWith('page.')) expr = expr.replace(/^page\./, `${receiver}.`);
    else if (expr.startsWith('this.page.')) expr = expr.replace(/^this\.page\./, `${receiver}.`);
    else expr = `${receiver}.${expr}`;
    // Prefer exact accessible-name matches to avoid substring collisions (Actions vs "…actions…").
    expr = expr.replace(
      /getByRole\((['"])([^'"]+)\1,\s*\{\s*name:\s*(['"])([^'"]*?)\3\s*\}\)/g,
      (full, q1: string, role: string, q2: string, name: string) => {
        if (/exact\s*:/.test(full)) return full;
        return `getByRole(${q1}${role}${q1}, { name: ${q2}${name}${q2}, exact: true })`;
      }
    );
    return expr;
  }

  switch (selector.kind) {
    case 'role': {
      const match = selector.value.match(/^([^[]+)(?:\[name='([^']+)'\])?$/);
      if (!match) return `${receiver}.getByRole('button')`;
      const role = match[1];
      const name = match[2];
      if (!name) return `${receiver}.getByRole('${escapeTsString(role)}')`;
      return `${receiver}.getByRole('${escapeTsString(role)}', { name: '${escapeTsString(name)}', exact: true })`;
    }
    case 'label':
      return `${receiver}.getByLabel('${escapeTsString(selector.value)}')`;
    case 'placeholder':
      return `${receiver}.getByPlaceholder('${escapeTsString(selector.value)}')`;
    case 'testid':
      return `${receiver}.getByTestId('${escapeTsString(selector.value)}')`;
    case 'text':
      return `${receiver}.getByText('${escapeTsString(selector.value)}')`;
    case 'css':
    case 'xpath':
      return `${receiver}.locator('${escapeTsString(selector.value)}')`;
    default:
      return `${receiver}.locator('${escapeTsString(selector.value)}')`;
  }
}

function selectorMetadataComment(selector: TraceSelector | undefined): string[] {
  if (!selector) return [];
  const pieces = [`confidence ${selector.confidence.toFixed(2)}`];
  if (selector.signals?.length) pieces.push(`signals: ${selector.signals.join(', ')}`);
  if (selector.risks?.length) pieces.push(`risks: ${selector.risks.join(', ')}`);
  const comments = [`// selector: ${pieces.join('; ')}`];
  if (selector.fallbacks?.length) {
    comments.push(
      `// fallbacks: ${selector.fallbacks
        .map((fallback) => `${fallback.expression || fallback.value} (${fallback.confidence.toFixed(2)})`)
        .join(' | ')}`
    );
  }
  return comments;
}

const STEP_PREFIX_STOP_WORDS = new Set(['and', 'then', 'when', 'given', 'but', 'also']);

/**
 * Clicking an autocomplete option right after a fill is racy — the dropdown can
 * close before the click. Emit a deterministic retype-and-retry, mirroring what
 * the ActHistory replay runner does at execution time.
 */
function autocompleteOptionRetry(
  step: TraceStep,
  lastFill: TraceStep | undefined,
  locator: string,
  receiver = 'this.page'
): string[] | null {
  if (step.action !== 'click' || !lastFill?.selector || !lastFill.value) return null;
  const isOptionClick =
    /getByRole\(\s*['"](option|listbox)['"]/.test(locator) ||
    /autocomplete/i.test(step.selector?.value || '');
  if (!isOptionClick) return null;
  const fillLocator = locatorExpression(lastFill.selector, receiver);
  if (!fillLocator) return null;
  return [
    `const option = ${locator}.first();`,
    `try {`,
    `  await option.waitFor({ state: 'visible', timeout: 8000 });`,
    `} catch {`,
    `  // Suggestions closed — retype to reopen the autocomplete dropdown.`,
    `  await ${fillLocator}.click();`,
    `  await ${fillLocator}.fill('${escapeTsString(lastFill.value)}');`,
    `  await option.waitFor({ state: 'visible', timeout: 8000 });`,
    `}`,
    `await option.click();`,
  ];
}

const MAX_METHOD_NAME_WORDS = 8;
const MAX_METHOD_NAME_LENGTH = 60;

export function methodNameFromStep(step: TraceStep, used: Set<string>): string {
  if (step.action === 'navigate') return ensureUnique('goto', used, step.index);

  // Prefer the semantic target over raw descriptions — descriptions may embed
  // giant tracking URLs that produce unusable method names.
  const nameSource =
    step.semanticTarget && /https?:|www\./i.test(step.intent)
      ? `${step.action} ${step.semanticTarget}`
      : step.intent;

  const words = nameSource
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_METHOD_NAME_WORDS);
  while (words.length > 0 && STEP_PREFIX_STOP_WORDS.has(words[0].toLowerCase())) {
    words.shift();
  }
  let base =
    words.length > 0
      ? words
          .map((word, index) =>
            index === 0
              ? word.toLowerCase()
              : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
          )
          .join('')
      : `${step.action}Step`;

  if (step.action === 'click' && !base.toLowerCase().startsWith('click')) {
    base = `click${base.charAt(0).toUpperCase()}${base.slice(1)}`;
  }
  if (step.action === 'fill' && !base.toLowerCase().startsWith('fill')) {
    base = `fill${base.charAt(0).toUpperCase()}${base.slice(1)}`;
  }
  if (step.action === 'assert' && !base.toLowerCase().startsWith('assert')) {
    base = `assert${base.charAt(0).toUpperCase()}${base.slice(1)}`;
  }
  if (step.optional && step.action === 'click' && !/ifpresent$/i.test(base)) {
    base = `${base}IfPresent`;
  }

  base = base.replace(/[^a-zA-Z0-9]/g, '');
  if (base.length > MAX_METHOD_NAME_LENGTH) base = base.slice(0, MAX_METHOD_NAME_LENGTH);
  if (!base) base = `${step.action}Step${step.index}`;
  return ensureUnique(base, used, step.index);
}

function ensureUnique(base: string, used: Set<string>, index: number): string {
  let name = base;
  let counter = 1;
  while (used.has(name)) {
    name = `${base}${counter}`;
    counter++;
  }
  used.add(name);
  return name;
}

/** Overlay dismissals (cookie banners, sign-in modals) may not appear on fresh contexts. */
function isOptionalOverlayStep(step: TraceStep): boolean {
  if (step.optional) return true;
  const haystack = `${step.intent || ''} ${step.description || ''} ${step.selector?.value || ''} ${step.selector?.expression || ''}`.toLowerCase();
  return /dismiss|close.*(dialog|modal|popup|banner)|sign.?in information|got it|no thanks|maybe later|cookie|consent|onetrust|one.?trust|continue shopping|accept all|accept cookies|if a (location|cookie)/i.test(
    haystack
  );
}

function optionalOverlayClick(locator: string): string[] {
  // BasePage.installOverlayGuards() auto-dismisses overlays whenever they appear,
  // so this step only needs a best-effort click when the control is present.
  return [
    `// Optional overlay/dialog — dismiss only when present so the script never fails either way.`,
    `const overlay = ${locator}.first();`,
    `if (await overlay.isVisible({ timeout: 3000 }).catch(() => false)) {`,
    `  await overlay.click({ force: true }).catch(() => {});`,
    `}`,
  ];
}

function isComboboxFill(step: TraceStep): boolean {
  const sel = step.selector;
  if (!sel) return false;
  if (sel.kind === 'role' && /^(combobox|searchbox)$/i.test(sel.value || '')) return true;
  return /\b(combobox|autocomplete|suggestion)\b/i.test(
    `${sel.expression || ''} ${sel.value || ''} ${step.intent || ''} ${step.description || ''}`
  );
}

function fillAssertionLines(step: TraceStep, receiver: string): string[] {
  const primaryAssertion = (step.assertions || [])[0];
  if (!primaryAssertion) return [];
  if (primaryAssertion.kind === 'value_equals' && isComboboxFill(step)) {
    return [];
  }
  return AssertionEmitter.typeScriptPlaywright(primaryAssertion, receiver);
}

function dynamicCalendarDateClick(offsetDays: number): string[] {
  return [
    `const targetDate = new Date();`,
    `targetDate.setHours(12, 0, 0, 0);`,
    `targetDate.setDate(targetDate.getDate() + ${offsetDays});`,
    `const isoDate = targetDate.toISOString().slice(0, 10);`,
    `let date = this.page.locator(\`[data-date="\${isoDate}"]\`).first();`,
    `if (!(await date.isVisible().catch(() => false))) {`,
    `  const datePicker = this.page.locator('[data-testid="searchbox-dates-container"], [data-testid="date-display-field-start"]').first();`,
    `  if (await datePicker.isVisible().catch(() => false)) await datePicker.click();`,
    `}`,
    `for (let month = 0; month < 3 && !(await date.isVisible().catch(() => false)); month++) {`,
    `  const next = this.page.getByRole('button', { name: /next month|next/i }).first();`,
    `  if (!(await next.isVisible().catch(() => false))) break;`,
    `  await next.click();`,
    `  date = this.page.locator(\`[data-date="\${isoDate}"]\`).first();`,
    `}`,
    `await date.click();`,
  ];
}

export function pageMethodBody(
  step: TraceStep,
  context?: { lastFill?: TraceStep; calendarOffsetDays?: number }
): string[] {
  const locator = locatorExpression(step.selector, 'this.page');
  const metadata = selectorMetadataComment(step.selector);
  const assertionLines = fillAssertionLines(step, 'this.page');
  switch (step.action) {
    case 'navigate':
      return step.url ? [`await this.navigate('${escapeTsString(step.url)}');`, ...assertionLines] : assertionLines;
    case 'click':
      if (context?.calendarOffsetDays) {
        return dynamicCalendarDateClick(context.calendarOffsetDays);
      }
      if (!locator) {
        if (/\bpress\s+enter\b/i.test(step.intent) || /^enter$/i.test(step.intent.trim())) {
          return [`await this.page.keyboard.press('Enter');`, ...assertionLines];
        }
        return [`// click: ${step.intent}`];
      }
      {
        if (isOptionalOverlayStep(step)) {
          return [...metadata, ...optionalOverlayClick(locator)];
        }
        const retry = autocompleteOptionRetry(step, context?.lastFill, locator, 'this.page');
        if (retry) return [...metadata, ...retry, ...assertionLines];
      }
      return [...metadata, `await ${locator}.click();`, ...assertionLines];
    case 'fill':
      if (!locator) return [`// fill: ${step.intent}`];
      if (isComboboxFill(step)) {
        // Click-focus then fill — Booking.com destination combobox ignores fill when covered/unfocused.
        return [
          ...metadata,
          `const field = ${locator}.first();`,
          `await field.click({ timeout: 8000 });`,
          `await field.fill('${escapeTsString(step.value || '')}');`,
          ...assertionLines,
        ];
      }
      return [...metadata, `await ${locator}.fill('${escapeTsString(step.value || '')}');`, ...assertionLines];
    case 'select':
      if (!locator) return [`// select: ${step.intent}`];
      return [...metadata, `await ${locator}.selectOption('${escapeTsString(step.value || '')}');`, ...assertionLines];
    case 'assert':
      if (assertionLines.length > 0) return assertionLines;
      if (locator) return [...metadata, `await expect(${locator}.first()).toBeVisible();`];
      if (step.url) {
        return [`await expect(this.page).toHaveURL(${JSON.stringify(step.url)});`, ...assertionLines];
      }
      return [`// assert: ${step.intent}`];
    case 'wait':
      // Bounded: ad/analytics-heavy pages (Booking, …) may never reach networkidle.
      return [
        `await this.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});`,
        ...assertionLines,
      ];
    case 'go_back':
      return [`await this.page.goBack();`];
    case 'screenshot':
      if (locator) {
        return [
          ...metadata,
          `await ${locator}.first().scrollIntoViewIfNeeded();`,
          `await ${locator}.first().screenshot({ path: 'test-results/codegen-section.png' });`,
        ];
      }
      return [`await this.page.screenshot({ path: 'test-results/codegen-page.png', fullPage: true });`];
    case 'press':
      return [
        `await this.page.keyboard.press('${escapeTsString(step.value || 'Enter')}');`,
        ...assertionLines,
      ];
    default:
      return [`// ${step.action}: ${step.intent}`];
  }
}

export function specStepBody(step: TraceStep, pageVar = 'page'): string[] {
  const locator = locatorExpression(step.selector, pageVar);
  const metadata = selectorMetadataComment(step.selector);
  const assertionLines = fillAssertionLines(step, pageVar);
  switch (step.action) {
    case 'navigate':
      return step.url ? [`await ${pageVar}.goto('${escapeTsString(step.url)}');`, ...assertionLines] : assertionLines;
    case 'click':
      if (!locator) {
        if (/\bpress\s+enter\b/i.test(step.intent) || /^enter$/i.test(step.intent.trim())) {
          return [`await ${pageVar}.keyboard.press('Enter');`, ...assertionLines];
        }
        return [`// click: ${step.intent}`, ...assertionLines];
      }
      return locator ? [...metadata, `await ${locator}.click();`, ...assertionLines] : [`// click: ${step.intent}`, ...assertionLines];
    case 'fill':
      if (!locator) return [`// fill: ${step.intent}`, ...assertionLines];
      if (isComboboxFill(step)) {
        return [
          ...metadata,
          `const field = ${locator}.first();`,
          `await field.click({ timeout: 8000 });`,
          `await field.fill('${escapeTsString(step.value || '')}');`,
          ...assertionLines,
        ];
      }
      return [...metadata, `await ${locator}.fill('${escapeTsString(step.value || '')}');`, ...assertionLines];
    case 'select':
      return locator
        ? [...metadata, `await ${locator}.selectOption('${escapeTsString(step.value || '')}');`, ...assertionLines]
        : [`// select: ${step.intent}`, ...assertionLines];
    case 'assert':
      if (assertionLines.length > 0) return assertionLines;
      if (locator) return [...metadata, `await expect(${locator}.first()).toBeVisible();`];
      if (step.url) {
        return [
          `await expect(${pageVar}).toHaveURL(${JSON.stringify(step.url)});`,
          ...assertionLines,
        ];
      }
      if (step.value) {
        return [`await expect(${pageVar}.getByText('${escapeTsString(step.value)}').first()).toBeVisible();`];
      }
      return [`// assert: ${step.intent}`];
    case 'wait':
      // Bounded: ad/analytics-heavy pages (Booking, …) may never reach networkidle.
      return [
        `await ${pageVar}.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});`,
        ...assertionLines,
      ];
    case 'go_back':
      return [`await ${pageVar}.goBack();`];
    case 'screenshot':
      if (locator) {
        return [
          ...metadata,
          `await ${locator}.first().scrollIntoViewIfNeeded();`,
          `await ${locator}.first().screenshot({ path: 'test-results/codegen-section.png' });`,
        ];
      }
      return [
        `await ${pageVar}.screenshot({ path: 'test-results/codegen-page.png', fullPage: true });`,
      ];
    case 'press':
      return [
        `await ${pageVar}.keyboard.press('${escapeTsString(step.value || 'Enter')}');`,
        ...assertionLines,
      ];
    default:
      return [`// ${step.action}: ${step.intent}`];
  }
}

export function normalizeProjectRelativePath(filePath: string): string {
  let normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const cwd = process.cwd().replace(/\\/g, '/').replace(/\/$/, '');
  if (normalized.startsWith(`${cwd}/`)) {
    normalized = normalized.slice(cwd.length + 1);
  }
  return normalized;
}

/** Import path from a generated spec to a page object (depth-aware for nested tests/). */
export function specImportPath(fromFile: string, targetFile: string): string {
  const from = normalizeProjectRelativePath(fromFile);
  const target = normalizeProjectRelativePath(targetFile).replace(/\.tsx?$/, '');

  const frameworkPagesPrefix = 'packages/test-framework/pages/';
  if (target.startsWith(frameworkPagesPrefix)) {
    // Nested specs (tests/<site>/…) need ../../pages/… — never hardcode a single ../.
    if (from.includes('/tests/')) {
      return relativeImportPath(from, `${target}.ts`);
    }
    return `@pages/${target.slice(frameworkPagesPrefix.length)}`;
  }

  const pagesMarker = '/pages/';
  const pagesIdx = target.lastIndexOf(pagesMarker);
  if (pagesIdx >= 0 && from.includes('/tests/')) {
    return relativeImportPath(from, `${target}.ts`);
  }

  return relativeImportPath(from, `${target}.ts`);
}

export function relativeImportPath(fromFile: string, targetFile: string): string {
  const from = normalizeProjectRelativePath(fromFile);
  const target = normalizeProjectRelativePath(targetFile).replace(/\.tsx?$/, '');

  const fromDir = from.split('/').slice(0, -1);
  const targetParts = target.split('/');
  let common = 0;
  while (
    common < fromDir.length &&
    common < targetParts.length &&
    fromDir[common] === targetParts[common]
  ) {
    common++;
  }
  const up = '../'.repeat(fromDir.length - common);
  const down = targetParts.slice(common).join('/');
  return `${up}${down}`;
}
