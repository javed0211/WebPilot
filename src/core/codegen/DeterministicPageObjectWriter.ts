import * as fs from 'fs';
import * as path from 'path';
import { MethodInfo, SymbolParser } from '../SymbolParser';
import { ExecutionTrace, TraceStep } from './ExecutionTrace';
import { GenerationPlan, PlannedFile } from './GenerationPlan';
import { stepsForPage as mappedStepsForPage } from './PageMapping';
import {
  bindingDedupeKey,
  bindParameterizedMethod,
} from './ParameterizedMethodBinder';
import {
  methodNameFromStep,
  pageMethodBody,
  relativeImportPath,
} from './CodegenExpressions';

export interface PageObjectArtifact {
  path: string;
  className: string;
  content: string;
  operation: 'create' | 'extend' | 'reuse';
  stepMethods: Record<number, string>;
  /** Arguments for parameterized reuse (e.g. assertSectionVisible('See also')). */
  stepMethodArgs?: Record<number, string[]>;
}

export const POM_STEP_COVERED = '__covered_by_pom__';

function mapStepToExistingMethod(step: TraceStep, existing: Set<string>): string | null {
  const action = (step.action || '').toLowerCase();
  const intent = `${step.intent || ''} ${step.description || ''}`.toLowerCase();

  if (action === 'navigate' && existing.has('goto')) return 'goto';
  if (action === 'go_back' || intent.includes('navigate back') || intent.includes('go back')) {
    return 'goBack';
  }

  // Generic intent/target-based reuse: tokenize the step's semantic target and
  // intent, and score against every existing method name. Reuse only when the
  // action prefix agrees (click→click*, fill→fill*/search, assert→assert*) and
  // token overlap is strong. This replaces per-site hardcoded mappings.
  const generic = genericMethodMatch(step, existing);
  if (generic) return generic;

  // Legacy curated mappings (Wikipedia demo pages) — kept as fallback.
  if ((intent.includes('view history') || intent.includes('click view history')) && existing.has('clickViewHistory')) {
    return 'clickViewHistory';
  }
  if (action === 'click' && /\btalk\b/i.test(intent) && existing.has('clickTalk')) {
    return 'clickTalk';
  }
  if (existing.has('assertHomePageLoaded') && (intent.includes('homepage') || intent.includes('wikipedia homepage'))) {
    // Only at true home entry — avoid late assertion-plan leftovers remapping to home.
    if (action === 'navigate' || intent.includes('loads successfully') || intent.includes('search wikipedia is visible')) {
      return 'assertHomePageLoaded';
    }
  }
  if (existing.has('assertOnHistoryPage') && intent.includes('revision')) return 'assertOnHistoryPage';
  if (
    existing.has('assertOnTalkPage') &&
    (intent.includes('talk:') ||
      (intent.includes('talk') && (intent.includes('categories') || intent.includes('last edited') || intent.includes('verify'))))
  ) {
    // Prefer talk asserts only while on talk URLs — caller filters by page.
    if (intent.includes('categories') || intent.includes('last edited') || /talk:/i.test(intent)) {
      return 'assertOnTalkPage';
    }
  }
  if (
    existing.has('assertOnArticlePage') &&
    (intent.includes('see also') ||
      intent.includes('references') ||
      intent.includes('external links') ||
      intent.includes('from wikipedia') ||
      intent.includes('software testing is displayed') ||
      intent.includes('article is displayed') ||
      intent.includes('categories is displayed') ||
      intent.includes('last edited') ||
      (intent.includes('verify') && intent.includes('wikipedia') && !intent.includes('homepage') && !intent.includes('search wikipedia')))
  ) {
    return 'assertOnArticlePage';
  }
  // Prefer combined search(term) over fill+submit when available.
  if (
    (action === 'fill' || action === 'input' || action === 'type' || intent.includes('enter ')) &&
    step.value &&
    existing.has('search')
  ) {
    return 'search';
  }
  if ((action === 'fill' || action === 'input' || action === 'type' || intent.includes('enter ')) && existing.has('fillSearch') && step.value) {
    return 'fillSearch';
  }
  if (
    (intent.includes('click search') || (action === 'click' && /\bsearch\b/i.test(intent) && !/\btalk\b/i.test(intent))) &&
    existing.has('submitSearch')
  ) {
    return 'submitSearch';
  }
  if (intent.includes('screenshot') && existing.has('screenshotHeading')) return 'screenshotHeading';
  if (existing.has('assertRevisionHistoryVisible') && intent.includes('revision history')) {
    return 'assertRevisionHistoryVisible';
  }
  return null;
}

const GENERIC_STOP_TOKENS = new Set([
  'the', 'a', 'an', 'to', 'in', 'on', 'of', 'and', 'or', 'is', 'are', 'was',
  'click', 'clicked', 'fill', 'filled', 'enter', 'entered', 'input', 'assert',
  'verify', 'check', 'button', 'link', 'field', 'page', 'element',
]);

function tokenizeForMatch(text: string): Set<string> {
  return new Set(
    text
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !GENERIC_STOP_TOKENS.has(t))
  );
}

function actionPrefixCompatible(action: string, methodName: string): boolean {
  const m = methodName.toLowerCase();
  if (action === 'click') return m.startsWith('click') || m.startsWith('open') || m.startsWith('select') || m.startsWith('submit');
  if (action === 'fill') return m.startsWith('fill') || m.startsWith('enter') || m.startsWith('search') || m.startsWith('type');
  if (action === 'assert') return m.startsWith('assert') || m.startsWith('verify') || m.startsWith('expect');
  if (action === 'select') return m.startsWith('select') || m.startsWith('choose');
  return false;
}

/**
 * Score existing page-object methods against the step's semantic target/intent.
 * Reuse requires a compatible action prefix and ≥60% token overlap of the
 * step's meaningful tokens with the method-name tokens.
 */
function genericMethodMatch(step: TraceStep, existing: Set<string>): string | null {
  const action = (step.action || '').toLowerCase();
  if (!['click', 'fill', 'assert', 'select'].includes(action)) return null;

  const stepTokens = tokenizeForMatch(
    `${step.semanticTarget || ''} ${step.intent || ''}`
  );
  if (stepTokens.size === 0) return null;

  let best: { name: string; score: number } | null = null;
  for (const name of existing) {
    if (!actionPrefixCompatible(action, name)) continue;
    const methodTokens = tokenizeForMatch(name);
    if (methodTokens.size === 0) continue;
    let overlap = 0;
    for (const t of methodTokens) {
      if (stepTokens.has(t)) overlap += 1;
    }
    // Ratio against the smaller token set — a short focused method name that is
    // fully contained in the step intent should score 1.0.
    const ratio = overlap / Math.min(methodTokens.size, stepTokens.size);
    if (ratio >= 0.6 && overlap >= 1 && (!best || ratio > best.score)) {
      best = { name, score: ratio };
    }
  }
  return best?.name || null;
}

function stepsForPage(page: PlannedFile, trace: ExecutionTrace, allPages: PlannedFile[]): TraceStep[] {
  if (!page.urlPattern) return [];
  // Shared mapping: url → pageCandidate → urlBefore → urlAfter, one page per step.
  return mappedStepsForPage(page, trace, allPages);
}

function existingMethods(filePath: string, className: string): MethodInfo[] {
  const fullPath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) return [];
  try {
    const classes = SymbolParser.parseFile(fullPath);
    const match = classes.find((info) => info.name === className);
    return match?.methods || [];
  } catch {
    return [];
  }
}

function existingMethodNames(filePath: string, className: string): Set<string> {
  return new Set(existingMethods(filePath, className).map((method) => method.name));
}

function basePageImport(pagePath: string, url?: string): { importPath: string; baseClass: string } {
  if (url?.includes('automationexercise.com') || pagePath.includes('automationexercise/')) {
    return {
      importPath: './AutomationExerciseBasePage',
      baseClass: 'AutomationExerciseBasePage',
    };
  }
  return {
    importPath: relativeImportPath(pagePath, 'packages/test-framework/core/BasePage'),
    baseClass: 'BasePage',
  };
}

function pageIdentity(className: string): string {
  return className;
}

function buildMethod(
  step: TraceStep,
  usedNames: Set<string>,
  existing: Set<string>,
  context?: { lastFill?: TraceStep; calendarOffsetDays?: number }
): {
  name: string;
  body: string;
} | null {
  let name = methodNameFromStep(step, usedNames);
  if (existing.has(name)) return null;
  if (step.action === 'navigate' && existing.has('goto')) return null;

  const bodyLines = pageMethodBody(step, context);
  if (bodyLines.length === 0 || bodyLines.every((line) => line.trim().startsWith('//'))) {
    return null;
  }

  const needsExpect = bodyLines.some((line) => line.includes('expect('));
  const body = bodyLines.map((line) => `    ${line}`).join('\n');
  return { name, body: `${needsExpect ? '' : ''}${body}` };
}

function renderPageClass(
  page: PlannedFile,
  methods: Array<{ name: string; body: string }>,
  url?: string
): string {
  const className = page.className || 'GeneratedPage';
  const { importPath, baseClass } = basePageImport(page.path, url);
  const needsExpect = methods.some((method) => method.body.includes('expect('));
  const imports = [
    `import { ${baseClass} } from '${importPath}';`,
    `import { Page } from '@playwright/test';`,
    ...(needsExpect ? [`import { expect } from '@playwright/test';`] : []),
  ];

  const methodBlocks = methods
    .map(
      (method) => `  public async ${method.name}(): Promise<void> {
${method.body}
  }`
    )
    .join('\n\n');

  const urlPattern = page.urlPattern || url || '';
  return `${imports.join('\n')}

/**
 * @pageIdentity ${pageIdentity(className)}
 * @urlPattern ${urlPattern}
 */
export class ${className} extends ${baseClass} {
  constructor(page: Page) {
    super(page);
  }

${methodBlocks}
}
`;
}

function renderPartialClass(className: string, methods: Array<{ name: string; body: string }>): string {
  const needsExpect = methods.some((method) => method.body.includes('expect('));
  const imports = needsExpect ? `import { expect } from '@playwright/test';\n` : '';
  const methodBlocks = methods
    .map(
      (method) => `  public async ${method.name}(): Promise<void> {
${method.body}
  }`
    )
    .join('\n\n');

  return `${imports}export class ${className} {
${methodBlocks}
}`;
}

export class DeterministicPageObjectWriter {
  public static write(trace: ExecutionTrace, plan: GenerationPlan): PageObjectArtifact[] {
    const artifacts: PageObjectArtifact[] = [];

    for (const page of plan.pageObjects) {
      if (!page.className) continue;
      const pageSteps = stepsForPage(page, trace, plan.pageObjects);
      if (pageSteps.length === 0) continue;

      const usedNames = new Set<string>();
      const methodInfos = existingMethods(page.path, page.className);
      const existing = new Set(methodInfos.map((method) => method.name));
      const methods: Array<{ name: string; body: string }> = [];
      const stepMethods: Record<number, string> = {};
      const stepMethodArgs: Record<number, string[]> = {};
      let usedCombinedSearch = false;
      const usedBindings = new Set<string>();
      let lastFill: TraceStep | undefined;
      let calendarDateIndex = 0;

      for (const step of pageSteps) {
        const isCalendarDate =
          step.action === 'click' &&
          /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
            `${step.semanticTarget || ''} ${step.intent || ''} ${step.selector?.value || ''}`
          ) &&
          /\b20\d{2}\b/.test(`${step.semanticTarget || ''} ${step.intent || ''} ${step.selector?.value || ''}`);
        const calendarOffsetDays = isCalendarDate ? (calendarDateIndex++ === 0 ? 7 : 9) : undefined;
        if (calendarOffsetDays && existing.has(calendarOffsetDays === 7 ? 'selectCheckInDate' : 'selectCheckOutDate')) {
          stepMethods[step.index] = calendarOffsetDays === 7 ? 'selectCheckInDate' : 'selectCheckOutDate';
          continue;
        }

        // Prefer signature-aware parameterized reuse (assertSectionVisible('See also')).
        const parameterized = bindParameterizedMethod(step, methodInfos);
        if (parameterized) {
          const key = bindingDedupeKey(parameterized);
          if (usedBindings.has(key)) {
            stepMethods[step.index] = POM_STEP_COVERED;
            continue;
          }
          usedBindings.add(key);
          stepMethods[step.index] = parameterized.method;
          if (parameterized.args.length) stepMethodArgs[step.index] = parameterized.args;
          if (step.action === 'fill') lastFill = step;
          continue;
        }

        const reused = mapStepToExistingMethod(step, existing);
        if (reused) {
          if (reused === 'search') usedCombinedSearch = true;
          if (reused === 'submitSearch' && usedCombinedSearch) {
            stepMethods[step.index] = POM_STEP_COVERED;
            continue;
          }
          const zeroArgKey = `${reused}()`;
          if (reused.startsWith('assert') && usedBindings.has(zeroArgKey)) {
            stepMethods[step.index] = POM_STEP_COVERED;
            continue;
          }
          if (reused.startsWith('assert')) usedBindings.add(zeroArgKey);
          stepMethods[step.index] = reused;
          if (step.action === 'fill' && step.value) {
            stepMethodArgs[step.index] = [step.value];
          }
          if (step.action === 'fill') lastFill = step;
          continue;
        }
        if (page.operation === 'reuse') {
          // Curated POM — do not invent parallel assertCustom* methods.
          continue;
        }
        const method = buildMethod(step, usedNames, existing, { lastFill, calendarOffsetDays });
        if (step.action === 'fill') lastFill = step;
        if (!method) {
          if (step.action === 'navigate' && existing.has('goto')) {
            stepMethods[step.index] = 'goto';
          }
          continue;
        }
        methods.push(method);
        stepMethods[step.index] = method.name;
      }

      if (methods.length === 0) {
        if (Object.keys(stepMethods).length === 0) continue;
        // Reuse curated POM methods without rewriting the page file.
        artifacts.push({
          path: page.path,
          className: page.className,
          content: '',
          operation: 'reuse',
          stepMethods,
          stepMethodArgs,
        });
        continue;
      }

      const primaryUrl = page.urlPattern || pageSteps.find((step) => step.url)?.url;
      const pageFilePath = path.join(process.cwd(), page.path);
      const shouldReplaceStubPage =
        page.operation === 'extend' && fs.existsSync(pageFilePath) && existing.size === 0;
      const content =
        page.operation === 'extend' && fs.existsSync(pageFilePath) && !shouldReplaceStubPage
          ? renderPartialClass(page.className, methods)
          : renderPageClass(page, methods, primaryUrl);

      artifacts.push({
        path: page.path,
        className: page.className,
        content,
        operation: page.operation === 'extend' && !shouldReplaceStubPage ? 'extend' : 'create',
        stepMethods,
        stepMethodArgs,
      });
    }

    return artifacts;
  }
}
