import * as fs from 'fs';
import * as path from 'path';
import { CodegenPlaywrightValidator } from '../CodegenPlaywrightValidator';
import { ConfigManager } from '../ConfigManager';
import { CodegenProfileRegistry } from './profiles/CodegenProfileRegistry';

export interface ExistingCodegenReuse {
  reuse: boolean;
  reason: string;
  specPath?: string;
}

/**
 * If a generated Playwright spec already exists and passes, skip regenerating it.
 * Prevents repeat --codegen runs from burning LLM tokens and regressing curated POMs.
 *
 * Force regen: WEBPILOT_FORCE_CODEGEN=1
 */
export function tryReuseExistingGeneratedSpec(slug: string): ExistingCodegenReuse {
  if (process.env.WEBPILOT_FORCE_CODEGEN === '1') {
    return { reuse: false, reason: 'WEBPILOT_FORCE_CODEGEN=1' };
  }

  const profile = {
    language: ConfigManager.getInstance().get('project.language', 'typescript'),
    automationTool: ConfigManager.getInstance().get('project.automationTool', 'playwright'),
    frameworkPattern: ConfigManager.getInstance().get('project.frameworkPattern', 'pom'),
    testFramework: ConfigManager.getInstance().get('project.testFramework', 'playwright-test'),
  };
  if (profile.language !== 'typescript' || profile.automationTool !== 'playwright') {
    return { reuse: false, reason: 'existing-spec reuse is only for TypeScript Playwright' };
  }

  const adapter = CodegenProfileRegistry.resolve(profile);
  const specPath = adapter.specPath(slug, profile);
  const full = path.join(process.cwd(), specPath);
  if (!fs.existsSync(full)) {
    return { reuse: false, reason: `no existing spec at ${specPath}` };
  }

  const content = fs.readFileSync(full, 'utf8');
  // Prefer curated site-folder imports — junk Www*/En*org* specs should be regenerated.
  const usesCuratedSiteFolder = /from ['"]\.\.\/pages\/[a-z0-9_-]+\//i.test(content);
  const usesJunkFlatNames = /Www[a-z]+HomePage|En[a-z0-9]+org/i.test(content);
  if (usesJunkFlatNames && !usesCuratedSiteFolder) {
    return {
      reuse: false,
      reason: 'existing spec uses invented flat page classes — regenerating against curated POMs',
    };
  }

  const result = CodegenPlaywrightValidator.runSpecs([specPath]);
  if (!result.passed) {
    return {
      reuse: false,
      reason: `existing spec failed Playwright — will regenerate (${specPath})`,
      specPath,
    };
  }

  return {
    reuse: true,
    reason: `reusing existing passing spec ${specPath} (skipped codegen regenerate)`,
    specPath,
  };
}
