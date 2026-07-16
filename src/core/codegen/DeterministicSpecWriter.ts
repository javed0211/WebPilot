import { PageObjectArtifact } from './DeterministicPageObjectWriter';
import { ExecutionTrace, TraceStep } from './ExecutionTrace';
import { GenerationPlan, PlannedFile } from './GenerationPlan';
import { escapeTsString, specImportPath, specStepBody } from './CodegenExpressions';

function pageVarName(className: string): string {
  return className.charAt(0).toLowerCase() + className.slice(1);
}

function pageForStep(step: TraceStep, plan: GenerationPlan): PlannedFile | undefined {
  return plan.pageObjects.find((page) => {
    if (!step.url || !page.urlPattern) return false;
    const raw = page.urlPattern.replace(/^\/([\s\S]+)\/[a-z]*$/i, '$1');
    try {
      return new RegExp(raw).test(step.url);
    } catch {
      return step.url.includes(page.urlPattern);
    }
  });
}

function isHomeEntryNavigate(step: TraceStep): boolean {
  if (step.action !== 'navigate' || !step.url) return false;
  try {
    const pathname = new URL(step.url).pathname;
    return pathname === '/' || pathname === '';
  } catch {
    return false;
  }
}

export class DeterministicSpecWriter {
  public static write(
    trace: ExecutionTrace,
    plan: GenerationPlan,
    pageArtifacts: PageObjectArtifact[]
  ): { path: string; content: string } {
    const imports = new Set<string>(["import { test, expect } from '@playwright/test';"]);
    const body: string[] = [];
    const artifactByClass = new Map(pageArtifacts.map((artifact) => [artifact.className, artifact]));
    const instantiated = new Set<string>();

    for (const page of plan.pageObjects) {
      if (!page.className) continue;
      if (page.operation === 'create' && !artifactByClass.has(page.className)) continue;
      const importFrom = specImportPath(plan.specPath, page.path);
      imports.add(`import { ${page.className} } from '${importFrom}';`);
    }

    body.push(`test('${escapeTsString(trace.scenario)}', async ({ page }) => {`);

    for (const step of trace.steps) {
      const pagePlan = pageForStep(step, plan);
      const artifact = pagePlan?.className ? artifactByClass.get(pagePlan.className) : undefined;
      const methodName = artifact?.stepMethods[step.index];

      if (pagePlan?.className && !instantiated.has(pagePlan.className)) {
        body.push(`  const ${pageVarName(pagePlan.className)} = new ${pagePlan.className}(page);`);
        instantiated.add(pagePlan.className);
      }

      if (pagePlan?.className && methodName) {
        const varName = pageVarName(pagePlan.className);
        // Prefer Playwright page.goBack — BasePage.goBack is inherited but reference
        // validation only sees methods declared on the page class itself.
        if (methodName === 'goBack') {
          body.push('  await page.goBack();');
          continue;
        }
        if (
          (methodName === 'fillSearch' || methodName === 'search') &&
          step.value
        ) {
          body.push(`  await ${varName}.${methodName}('${escapeTsString(step.value)}');`);
        } else if (methodName === 'screenshotHeading') {
          body.push(`  await ${varName}.${methodName}('software_testing_heading.png');`);
        } else {
          body.push(`  await ${varName}.${methodName}();`);
        }
        continue;
      }

      // Curated reuse: skip unmapped steps instead of inventing raw page.* locators
      // that fight existing POM methods (and burn LLM repair tokens).
      if (pagePlan?.operation === 'reuse') {
        continue;
      }

      // Assertion-plan leftovers without a page match — skip when curated POMs already cover the flow.
      const hasCuratedReuse = plan.pageObjects.some((page) => page.operation === 'reuse');
      if (
        hasCuratedReuse &&
        (step.action === 'assert' ||
          /assertion\(/i.test(step.description || '') ||
          /^verify\b/i.test(step.intent || '') ||
          /^verify\b/i.test(step.description || '') ||
          /capture screenshot/i.test(step.description || '') ||
          /capture screenshot/i.test(step.intent || ''))
      ) {
        continue;
      }

      if (pagePlan?.className && step.action === 'navigate' && instantiated.has(pagePlan.className)) {
        if (isHomeEntryNavigate(step)) {
          const varName = pageVarName(pagePlan.className);
          body.push(`  await ${varName}.goto();`);
          continue;
        }
      }

      for (const line of specStepBody(step)) {
        body.push(`  ${line}`);
      }
    }

    body.push('});');

    return {
      path: plan.specPath,
      content: [...imports, '', ...body, ''].join('\n'),
    };
  }
}
