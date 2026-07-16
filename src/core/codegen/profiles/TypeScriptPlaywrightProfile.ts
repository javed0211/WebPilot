import { GeneratedFile } from '../../../agents/CodegenAgent';
import { DeterministicPageObjectWriter } from '../DeterministicPageObjectWriter';
import { DeterministicSpecWriter } from '../DeterministicSpecWriter';
import { ExecutionTrace } from '../ExecutionTrace';
import { CodegenProfilePlan, GenerationPlan } from '../GenerationPlan';
import { CodegenProfile } from './CodegenProfile';
import { inferSitePageFromUrl } from '../SitePageNaming';

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

  public pagePath(className: string, _profile?: CodegenProfilePlan, url?: string): string {
    if (className.startsWith('AutomationExercise')) {
      return `packages/test-framework/pages/automationexercise/${className}.ts`;
    }
    // Prefer site-folder layout when URL is known (booking.com → pages/booking/…).
    if (url) {
      const inferred = inferSitePageFromUrl(url);
      if (className === inferred.className) return inferred.pagePath;
      return `packages/test-framework/pages/${inferred.siteFolder}/${className}.ts`;
    }
    // Class names like BookingHomePage → pages/booking/
    const siteFromClass = className.match(/^([A-Z][a-z0-9]+)(.+)Page$/);
    if (siteFromClass && !/^Www/i.test(className)) {
      const folder = siteFromClass[1].toLowerCase();
      return `packages/test-framework/pages/${folder}/${className}.ts`;
    }
    return `packages/test-framework/pages/${className}.ts`;
  }

  public replayCommand(specPath: string): string {
    return `webpilot replay ${specPath}`;
  }

  public emit(trace: ExecutionTrace, plan: GenerationPlan): GeneratedFile[] {
    const pageArtifacts = DeterministicPageObjectWriter.write(trace, plan);
    const files: GeneratedFile[] = pageArtifacts
      .filter((artifact) => artifact.content.trim().length > 0)
      .map((artifact) => ({
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
