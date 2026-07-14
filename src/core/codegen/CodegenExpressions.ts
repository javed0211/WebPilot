import { TraceSelector, TraceStep } from './ExecutionTrace';
import { AssertionEmitter } from '../assertions/AssertionEmitter';

export function escapeTsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function locatorExpression(selector: TraceSelector | undefined, receiver = 'page'): string | null {
  if (!selector) return null;

  if (selector.expression) {
    const expr = selector.expression.trim();
    if (expr.startsWith('page.')) return expr.replace(/^page\./, `${receiver}.`);
    if (expr.startsWith('this.page.')) return expr.replace(/^this\.page\./, `${receiver}.`);
    return `${receiver}.${expr}`;
  }

  switch (selector.kind) {
    case 'role': {
      const match = selector.value.match(/^([^[]+)(?:\[name='([^']+)'\])?$/);
      if (!match) return `${receiver}.getByRole('button')`;
      const role = match[1];
      const name = match[2];
      return name
        ? `${receiver}.getByRole('${escapeTsString(role)}', { name: '${escapeTsString(name)}' })`
        : `${receiver}.getByRole('${escapeTsString(role)}')`;
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

export function methodNameFromStep(step: TraceStep, used: Set<string>): string {
  if (step.action === 'navigate') return ensureUnique('goto', used, step.index);

  const words = step.intent
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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

  base = base.replace(/[^a-zA-Z0-9]/g, '');
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

export function pageMethodBody(step: TraceStep): string[] {
  const locator = locatorExpression(step.selector, 'this.page');
  const metadata = selectorMetadataComment(step.selector);
  const primaryAssertion = (step.assertions || [])[0];
  const assertionLines = primaryAssertion
    ? AssertionEmitter.typeScriptPlaywright(primaryAssertion, 'this.page')
    : [];
  switch (step.action) {
    case 'navigate':
      return step.url ? [`await this.navigate('${escapeTsString(step.url)}');`, ...assertionLines] : assertionLines;
    case 'click':
      if (!locator) return [`// click: ${step.intent}`];
      return [...metadata, `await ${locator}.click();`, ...assertionLines];
    case 'fill':
      if (!locator) return [`// fill: ${step.intent}`];
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
      return [`await this.page.waitForLoadState('networkidle');`, ...assertionLines];
    case 'go_back':
      return [`await this.page.goBack();`, ...assertionLines];
    case 'screenshot':
      if (locator) {
        return [
          ...metadata,
          `await ${locator}.first().scrollIntoViewIfNeeded();`,
          `await ${locator}.first().screenshot({ path: 'test-results/codegen-section.png' });`,
          ...assertionLines,
        ];
      }
      return [`await this.page.screenshot({ path: 'test-results/codegen-page.png', fullPage: true });`, ...assertionLines];
    default:
      return [`// ${step.action}: ${step.intent}`];
  }
}

export function specStepBody(step: TraceStep, pageVar = 'page'): string[] {
  const locator = locatorExpression(step.selector, pageVar);
  const metadata = selectorMetadataComment(step.selector);
  const primaryAssertion = (step.assertions || [])[0];
  const assertionLines = primaryAssertion
    ? AssertionEmitter.typeScriptPlaywright(primaryAssertion, pageVar)
    : [];
  switch (step.action) {
    case 'navigate':
      return step.url ? [`await ${pageVar}.goto('${escapeTsString(step.url)}');`, ...assertionLines] : assertionLines;
    case 'click':
      return locator ? [...metadata, `await ${locator}.click();`, ...assertionLines] : [`// click: ${step.intent}`, ...assertionLines];
    case 'fill':
      return locator
        ? [...metadata, `await ${locator}.fill('${escapeTsString(step.value || '')}');`, ...assertionLines]
        : [`// fill: ${step.intent}`, ...assertionLines];
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
      return [`await ${pageVar}.waitForLoadState('networkidle');`, ...assertionLines];
    case 'go_back':
      return [`await ${pageVar}.goBack();`, ...assertionLines];
    case 'screenshot':
      if (locator) {
        return [
          ...metadata,
          `await ${locator}.first().scrollIntoViewIfNeeded();`,
          `await ${locator}.first().screenshot({ path: 'test-results/codegen-section.png' });`,
          ...assertionLines,
        ];
      }
      return [
        `await ${pageVar}.screenshot({ path: 'test-results/codegen-page.png', fullPage: true });`,
        ...assertionLines,
      ];
    default:
      return [`// ${step.action}: ${step.intent}`];
  }
}

function normalizeProjectRelativePath(filePath: string): string {
  let normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const cwd = process.cwd().replace(/\\/g, '/').replace(/\/$/, '');
  if (normalized.startsWith(`${cwd}/`)) {
    normalized = normalized.slice(cwd.length + 1);
  }
  return normalized;
}

/** Import path for generated specs — always one level up from tests/ to pages/. */
export function specImportPath(fromFile: string, targetFile: string): string {
  const from = normalizeProjectRelativePath(fromFile);
  const target = normalizeProjectRelativePath(targetFile).replace(/\.tsx?$/, '');

  const pagesMarker = '/pages/';
  const pagesIdx = target.lastIndexOf(pagesMarker);
  if (pagesIdx >= 0 && from.includes('/tests/')) {
    return `..${target.slice(pagesIdx)}`;
  }

  const frameworkPagesPrefix = 'packages/test-framework/pages/';
  if (target.startsWith(frameworkPagesPrefix)) {
    const suffix = target.slice(frameworkPagesPrefix.length);
    return `@pages/${suffix}`;
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
