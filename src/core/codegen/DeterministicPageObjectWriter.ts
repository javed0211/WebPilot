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
  operation: 'create' | 'extend';
  stepMethods: Record<number, string>;
}

function stepsForPage(page: PlannedFile, trace: ExecutionTrace): TraceStep[] {
  if (!page.urlPattern) return [];
  return trace.steps.filter((step) => {
    if (!step.url) return false;
    try {
      return new RegExp(page.urlPattern!).test(step.url);
    } catch {
      return step.url.includes(page.urlPattern!);
    }
  });
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

      for (const step of pageSteps) {
        const method = buildMethod(step, usedNames, existing);
        if (!method) continue;
        methods.push(method);
        stepMethods[step.index] = method.name;
      }

      if (methods.length === 0 && page.operation === 'extend') continue;

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
