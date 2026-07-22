import * as path from 'path';
import { ConfigManager } from '../ConfigManager';
import type { CodegenProfilePlan } from '../codegen/GenerationPlan';
import { readProjectCodegenProfile } from '../codegen/PostExecutionCodegen';

/**
 * Language-agnostic roots where codegen agents may read/write.
 * Derived from webpilot init profile — not hardcoded to TypeScript.
 */
export function resolveCodegenWriteRoots(profile?: CodegenProfilePlan): string[] {
  const p = profile ?? safeProfile();
  const roots = new Set<string>(['resources/']);

  const generated = String(
    ConfigManager.getInstance().get('framework.generatedCodePath', '') || ''
  )
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');

  if (generated) roots.add(generated.endsWith('/') ? generated : `${generated}/`);

  switch (p.language) {
    case 'python':
      roots.add('tests/generated/');
      roots.add('tests/support/');
      roots.add('tests/');
      break;
    case 'java':
      roots.add('src/test/java/');
      roots.add('src/main/java/');
      break;
    case 'csharp':
      roots.add('tests/');
      roots.add('tests/WebPilot.Tests/');
      break;
    case 'typescript':
    default:
      roots.add('packages/test-framework/');
      roots.add('tests/');
      if (p.automationTool === 'cypress') roots.add('cypress/');
      if (p.automationTool === 'webdriverio') roots.add('test/');
      break;
  }

  return [...roots];
}

export function pathAllowedForCodegen(relPath: string, profile?: CodegenProfilePlan): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.includes('..') || path.isAbsolute(relPath)) return false;
  return resolveCodegenWriteRoots(profile).some((root) => normalized.startsWith(root));
}

export function defaultPagesDir(profile?: CodegenProfilePlan): string {
  const p = profile ?? safeProfile();
  if (p.language === 'python') return 'tests/generated/pages';
  if (p.language === 'java') return 'src/test/java';
  if (p.language === 'csharp') return 'tests/WebPilot.Tests/Pages';
  return 'packages/test-framework/pages';
}

export function defaultTestsDir(profile?: CodegenProfilePlan): string {
  const p = profile ?? safeProfile();
  if (p.language === 'python') return 'tests/generated';
  if (p.language === 'java') return 'src/test/java';
  if (p.language === 'csharp') return 'tests/WebPilot.Tests';
  if (p.automationTool === 'cypress') return 'cypress/e2e';
  return 'packages/test-framework/tests';
}

export function guessSpecCandidates(slug: string, profile?: CodegenProfilePlan): string[] {
  const p = profile ?? safeProfile();
  const snake = slug.replace(/-/g, '_');
  const tests = defaultTestsDir(p);
  if (p.language === 'python') {
    return [`${tests}/test_${snake}.py`, `${tests}/test_${slug}.py`];
  }
  if (p.language === 'java') {
    const pascal = snake
      .split('_')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');
    return [`${tests}/${pascal}Test.java`, `${tests}/${pascal}.java`];
  }
  if (p.language === 'csharp') {
    const pascal = snake
      .split('_')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');
    return [`${tests}/${pascal}Tests.cs`, `${tests}/${pascal}.cs`];
  }
  return [
    `${tests}/${slug}.spec.ts`,
    `${tests}/${snake}.spec.ts`,
    `${tests}/${slug}.test.ts`,
  ];
}

export function runTestsCommand(slug: string, specPath: string, profile?: CodegenProfilePlan): string {
  const p = profile ?? safeProfile();
  if (p.language === 'python') return `pytest ${specPath} -q`;
  if (p.language === 'java') return `mvn -q -Dtest=*${slug}* test`;
  if (p.language === 'csharp') {
    return `dotnet test tests/WebPilot.Tests/WebPilot.Tests.csproj --filter FullyQualifiedName~${slug}`;
  }
  if (p.automationTool === 'cypress') return `npx cypress run --spec ${specPath}`;
  if (p.automationTool === 'webdriverio') return `npx wdio run wdio.conf.ts --spec ${specPath}`;
  return `npx playwright test ${specPath} --reporter=line`;
}

function safeProfile(): CodegenProfilePlan {
  try {
    return readProjectCodegenProfile();
  } catch {
    return {
      language: 'typescript',
      automationTool: 'playwright',
      frameworkPattern: 'pom',
    };
  }
}
