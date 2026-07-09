import { GeneratedFile } from '../../../agents/CodegenAgent';
import { ExecutionTrace, TraceStep } from '../ExecutionTrace';
import { CodegenProfilePlan, GenerationPlan } from '../GenerationPlan';
import { CodegenProfile, escapeSingle, roleParts } from './CodegenProfile';
import { AssertionEmitter } from '../../assertions/AssertionEmitter';

function cypressSelector(step: TraceStep): string | null {
  const selector = step.selector;
  if (!selector) return null;
  const role = roleParts(selector);
  if (role?.name) {
    return `cy.contains('[role="${escapeSingle(role.role)}"]', '${escapeSingle(role.name)}')`;
  }
  switch (selector.kind) {
    case 'label':
      return `cy.contains('label', '${escapeSingle(selector.value)}')`;
    case 'placeholder':
      return `cy.get('[placeholder="${escapeSingle(selector.value)}"]')`;
    case 'testid':
      return `cy.get('[data-testid="${escapeSingle(selector.value)}"]')`;
    case 'text':
      return `cy.contains('${escapeSingle(selector.value)}')`;
    case 'xpath':
      return `cy.xpath('${escapeSingle(selector.value)}')`;
    default:
      return `cy.get('${escapeSingle(selector.value)}')`;
  }
}

function stepLines(step: TraceStep): string[] {
  const locator = cypressSelector(step);
  const metadata = step.selector
    ? [`// selector: confidence ${step.selector.confidence.toFixed(2)}`]
    : [];
  const assertionLines = (step.assertions || []).flatMap((assertion) => AssertionEmitter.cypress(assertion));
  switch (step.action) {
    case 'navigate':
      return step.url ? [`cy.visit('${escapeSingle(step.url)}');`, ...assertionLines] : assertionLines;
    case 'click':
      return locator ? [...metadata, `${locator}.click();`, ...assertionLines] : [`// click: ${step.intent}`, ...assertionLines];
    case 'fill':
      return locator ? [...metadata, `${locator}.clear().type('${escapeSingle(step.value || '')}');`, ...assertionLines] : [`// fill: ${step.intent}`, ...assertionLines];
    case 'select':
      return locator ? [...metadata, `${locator}.select('${escapeSingle(step.value || '')}');`, ...assertionLines] : [`// select: ${step.intent}`, ...assertionLines];
    case 'assert':
      return assertionLines.length > 0 ? assertionLines : locator ? [...metadata, `${locator}.should('be.visible');`] : [`// assert: ${step.intent}`];
    case 'wait':
      return [`cy.wait(1000);`];
    default:
      return [`// ${step.action}: ${step.intent}`];
  }
}

export class TypeScriptCypressProfile implements CodegenProfile {
  public readonly id = 'typescript-cypress-simple';
  public readonly language = 'typescript';
  public readonly automationTool = 'cypress';
  public readonly testFramework = 'cypress';
  public readonly patterns = ['simple', 'pom'];

  public matches(profile: CodegenProfilePlan): boolean {
    return profile.language === 'typescript' && profile.automationTool === 'cypress';
  }

  public specPath(slug: string, _profile: CodegenProfilePlan): string {
    return `cypress/e2e/generated/${slug}.cy.ts`;
  }

  public pagePath(className: string, _profile: CodegenProfilePlan, _url?: string): string {
    return `cypress/support/pages/${className}.ts`;
  }

  public replayCommand(specPath: string): string {
    return `npx cypress run --spec ${specPath}`;
  }

  public emit(trace: ExecutionTrace, plan: GenerationPlan): GeneratedFile[] {
    const lines = [
      `describe('${trace.scenario.replace(/'/g, "\\'")}', () => {`,
      `  it('replays the WebPilot flow', () => {`,
    ];
    for (const step of trace.steps) {
      for (const line of stepLines(step)) {
        lines.push(`    ${line}`);
      }
    }
    lines.push('  });', '});', '');
    return [{ path: plan.specPath, content: lines.join('\n') }];
  }

  public validationCommand(_profile: CodegenProfilePlan): string {
    return 'npx tsc --noEmit';
  }
}
