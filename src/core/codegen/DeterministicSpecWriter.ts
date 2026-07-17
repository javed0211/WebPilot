import { PageObjectArtifact, POM_STEP_COVERED } from './DeterministicPageObjectWriter';
import { ExecutionTrace, TraceStep } from './ExecutionTrace';
import { GenerationPlan } from './GenerationPlan';
import { escapeTsString, specImportPath, specStepBody } from './CodegenExpressions';
import { pageForStep as mappedPageForStep } from './PageMapping';

function pageVarName(className: string): string {
  return className.charAt(0).toLowerCase() + className.slice(1);
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
  private static readonly diagnostics = new WeakMap<GenerationPlan, SpecWriteDiagnostics>();

  public static diagnosticsFor(plan: GenerationPlan): SpecWriteDiagnostics | undefined {
    return DeterministicSpecWriter.diagnostics.get(plan);
  }

  public static write(
    trace: ExecutionTrace,
    plan: GenerationPlan,
    pageArtifacts: PageObjectArtifact[]
  ): { path: string; content: string } {
    const imports = new Set<string>(["import { test, expect } from '@playwright/test';"]);
    const body: string[] = [];
    const artifactByClass = new Map(pageArtifacts.map((artifact) => [artifact.className, artifact]));
    const instantiated = new Set<string>();
    const mappedPomStepIndexes: number[] = [];
    const unmappedStepIndexes: number[] = [];
    const rawFallbackStepIndexes: number[] = [];
    const omittedStepIndexes: number[] = [];

    for (const page of plan.pageObjects) {
      if (!page.className) continue;
      if (!artifactByClass.has(page.className)) continue;
      const importFrom = specImportPath(plan.specPath, page.path);
      imports.add(`import { ${page.className} } from '${importFrom}';`);
    }

    body.push(`test('${escapeTsString(trace.scenario)}', async ({ page }) => {`);

    for (const step of trace.steps) {
      const pagePlan = mappedPageForStep(step, plan.pageObjects, trace);
      const artifact = pagePlan?.className ? artifactByClass.get(pagePlan.className) : undefined;
      const methodName = artifact?.stepMethods[step.index];

      if (artifact && pagePlan?.className && !instantiated.has(pagePlan.className)) {
        body.push(`  const ${pageVarName(pagePlan.className)} = new ${pagePlan.className}(page);`);
        instantiated.add(pagePlan.className);
      }

      if (pagePlan?.className && methodName) {
        if (methodName === POM_STEP_COVERED) {
          mappedPomStepIndexes.push(step.index);
          continue;
        }
        const varName = pageVarName(pagePlan.className);
        // Prefer Playwright page.goBack — BasePage.goBack is inherited but reference
        // validation only sees methods declared on the page class itself.
        if (methodName === 'goBack') {
          body.push('  await page.goBack();');
          mappedPomStepIndexes.push(step.index);
          continue;
        }
        const boundArgs = artifact.stepMethodArgs?.[step.index];
        if (boundArgs?.length) {
          const rendered = boundArgs.map((arg) => `'${escapeTsString(arg)}'`).join(', ');
          body.push(`  await ${varName}.${methodName}(${rendered});`);
        } else if (
          (methodName === 'fillSearch' || methodName === 'search') &&
          step.value
        ) {
          body.push(`  await ${varName}.${methodName}('${escapeTsString(step.value)}');`);
        } else if (methodName === 'screenshotHeading') {
          body.push(`  await ${varName}.${methodName}('software_testing_heading.png');`);
        } else {
          body.push(`  await ${varName}.${methodName}();`);
        }
        mappedPomStepIndexes.push(step.index);
        continue;
      }

      if (pagePlan?.className && step.action === 'navigate' && instantiated.has(pagePlan.className)) {
        if (isHomeEntryNavigate(step)) {
          const varName = pageVarName(pagePlan.className);
          body.push(`  await ${varName}.goto();`);
          mappedPomStepIndexes.push(step.index);
          continue;
        }
      }

      const fallbackLines = specStepBody(step);
      const executableFallback = fallbackLines.some((line) => !line.trim().startsWith('//'));
      unmappedStepIndexes.push(step.index);
      if (executableFallback) rawFallbackStepIndexes.push(step.index);
      else omittedStepIndexes.push(step.index);
      for (const line of fallbackLines) {
        body.push(`  ${line}`);
      }
    }

    body.push('});');

    const content = [...imports, '', ...body, ''].join('\n');
    const result: SpecWriteDiagnostics = {
      mappedPomStepIndexes,
      unmappedStepIndexes,
      rawFallbackUsed: rawFallbackStepIndexes.length > 0,
      rawFallbackStepIndexes,
      omittedStepIndexes,
    };
    DeterministicSpecWriter.diagnostics.set(plan, result);
    if (result.rawFallbackUsed || mappedPomStepIndexes.length === 0) {
      plan.notes.push(
        `Codegen quality: DEGRADED — ${mappedPomStepIndexes.length} POM step(s) mapped; ` +
          `${rawFallbackStepIndexes.length} raw Playwright fallback step(s). ` +
          'See runtime/codegen/audit/<slug>.json.'
      );
      console.warn(
        `[Codegen] DEGRADED spec for ${trace.scenarioSlug}: ${mappedPomStepIndexes.length} POM mapping(s), ` +
          `${rawFallbackStepIndexes.length} explicit raw fallback(s).`
      );
    }

    return {
      path: plan.specPath,
      content,
    };
  }
}

export interface SpecWriteDiagnostics {
  mappedPomStepIndexes: number[];
  unmappedStepIndexes: number[];
  rawFallbackUsed: boolean;
  rawFallbackStepIndexes: number[];
  omittedStepIndexes: number[];
}
