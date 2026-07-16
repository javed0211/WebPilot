import * as fs from 'fs';
import * as path from 'path';
import { SymbolParser } from '../SymbolParser';
import { ExecutionTrace, TraceStep } from './ExecutionTrace';
import { GenerationPlan, PlannedFile } from './GenerationPlan';
import {
  escapeTsString,
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
}

function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, '') || '/';
    return `${parsed.origin}${path}`;
  } catch {
    return url.replace(/\/$/, '') || url;
  }
}

function urlsMatchPage(pattern: string, url: string): boolean {
  if (!pattern || !url) return false;
  const raw = pattern.replace(/^\/([\s\S]+)\/[a-z]*$/i, '$1');
  try {
    if (new RegExp(raw).test(url)) return true;
  } catch {
    /* fall through */
  }
  try {
    return normalizeUrlKey(pattern) === normalizeUrlKey(url);
  } catch {
    return url.includes(pattern);
  }
}

function mapStepToExistingMethod(step: TraceStep, existing: Set<string>): string | null {
  const action = (step.action || '').toLowerCase();
  const intent = `${step.intent || ''} ${step.description || ''}`.toLowerCase();

  if (action === 'navigate' && existing.has('goto')) return 'goto';
  if (action === 'go_back' || intent.includes('navigate back') || intent.includes('go back')) {
    return 'goBack';
  }
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

function stepsForPage(page: PlannedFile, trace: ExecutionTrace): TraceStep[] {
  if (!page.urlPattern) return [];
  // Prefer exact origin+pathname match. Raw RegExp(urlPattern) wrongly treated
  // https://github.com/ as matching every github.com page, and broke on ?query URLs.
  return trace.steps.filter((step) => step.url && urlsMatchPage(page.urlPattern!, step.url));
}

function existingMethodNames(filePath: string, className: string): Set<string> {
  const fullPath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) return new Set();
  try {
    const classes = SymbolParser.parseFile(fullPath);
    const match = classes.find((info) => info.name === className);
    return new Set(match?.methods.map((method) => method.name) || []);
  } catch {
    return new Set();
  }
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

function buildMethod(step: TraceStep, usedNames: Set<string>, existing: Set<string>): {
  name: string;
  body: string;
} | null {
  let name = methodNameFromStep(step, usedNames);
  if (existing.has(name)) return null;
  if (step.action === 'navigate' && existing.has('goto')) return null;

  const bodyLines = pageMethodBody(step);
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
      const pageSteps = stepsForPage(page, trace);
      if (pageSteps.length === 0) continue;

      const usedNames = new Set<string>();
      const existing = existingMethodNames(page.path, page.className);
      const methods: Array<{ name: string; body: string }> = [];
      const stepMethods: Record<number, string> = {};
      let usedCombinedSearch = false;
      const usedAsserts = new Set<string>();

      for (const step of pageSteps) {
        const reused = mapStepToExistingMethod(step, existing);
        if (reused) {
          if (reused === 'search') usedCombinedSearch = true;
          if (reused === 'submitSearch' && usedCombinedSearch) continue;
          if (reused.startsWith('assert') && usedAsserts.has(reused)) continue;
          if (reused.startsWith('assert')) usedAsserts.add(reused);
          stepMethods[step.index] = reused;
          continue;
        }
        if (page.operation === 'reuse') {
          // Curated POM — do not invent parallel assertCustom* methods.
          continue;
        }
        const method = buildMethod(step, usedNames, existing);
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
      });
    }

    return artifacts;
  }
}
