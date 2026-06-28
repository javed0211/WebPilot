import { GeneratedFile } from '../../../agents/CodegenAgent';
import { DeterministicPageObjectWriter } from '../DeterministicPageObjectWriter';
import { DeterministicSpecWriter } from '../DeterministicSpecWriter';
import { ExecutionTrace } from '../ExecutionTrace';
import { CodegenProfilePlan, GenerationPlan } from '../GenerationPlan';
import { CodegenProfile } from './CodegenProfile';

export class TypeScriptPlaywrightProfile implements CodegenProfile {
  public readonly id = 'typescript-playwright-pom';
  public readonly language = 'typescript';
  public readonly automationTool = 'playwright';
  public readonly testFramework = 'playwright-test';
  public readonly patterns = ['pom', 'simple', 'bdd', 'pom-bdd'];

  public matches(profile: CodegenProfilePlan): boolean {
    return profile.language === 'typescript' && profile.automationTool === 'playwright';
  }

  public specPath(slug: string): string {
    return `packages/test-framework/tests/${slug}.spec.ts`;
  }

  public pagePath(className: string): string {
    if (className.startsWith('AutomationExercise')) {
      return `packages/test-framework/pages/automationexercise/${className}.ts`;
    }
    return `packages/test-framework/pages/${className}.ts`;
  }

  public replayCommand(specPath: string): string {
    return `webpilot replay ${specPath}`;
  }

  public emit(trace: ExecutionTrace, plan: GenerationPlan): GeneratedFile[] {
    const pageArtifacts = DeterministicPageObjectWriter.write(trace, plan);
    const files: GeneratedFile[] = pageArtifacts.map((artifact) => ({
      path: artifact.path,
      content: artifact.content,
    }));
    files.push(DeterministicSpecWriter.write(trace, plan, pageArtifacts));
    return files;
  }

  public validationCommand(): string {
    return 'npm run build';
  }
}
