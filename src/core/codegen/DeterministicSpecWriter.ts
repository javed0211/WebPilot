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
    try {
      return new RegExp(page.urlPattern).test(step.url);
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
        body.push(`  await ${pageVarName(pagePlan.className)}.${methodName}();`);
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
