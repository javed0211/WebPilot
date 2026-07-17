import { GeneratedFile } from '../agents/CodegenAgent';
import {
  AUTOMATION_EXERCISE_CANONICAL_PATHS,
  CANONICAL_PAGE_CONTENT,
  CANONICAL_SPEC_BY_SLUG,
} from './CodegenCanonicalPages';
import {
  FRAMEWORK_BASE_PAGE_REL_PATH,
  ensureFrameworkTsConfig,
  resolveFrameworkBasePageContent,
} from './FrameworkTemplates';
import {
  normalizeProjectRelativePath,
  relativeImportPath,
} from './codegen/CodegenExpressions';

export interface NormalizeOptions {
  testSlug?: string;
  urls?: string[];
}

function canonicalPomsEnabled(): boolean {
  return process.env.WEBPILOT_CANONICAL_POMS === '1';
}

/**
 * Light post-processing for generated files.
 *
 * By default: import path fixes only (no hardcoded POM/spec replacement).
 * Opt-in legacy behavior: WEBPILOT_CANONICAL_POMS=1 replaces automationexercise
 * output with battle-tested canonical POMs (deprecated — prefer ActHistory codegen).
 */
export class CodegenNormalizer {
  public static touchesAutomationExercise(files: GeneratedFile[], options?: NormalizeOptions): boolean {
    if (options?.testSlug?.includes('automationexercise')) {
      return true;
    }
    if (options?.urls?.some((u) => u.includes('automationexercise.com'))) {
      return true;
    }
    return files.some(
      (f) =>
        f.path.includes('automationexercise') ||
        f.content.includes('automationexercise.com')
    );
  }

  public static normalize(files: GeneratedFile[], options?: NormalizeOptions): GeneratedFile[] {
    const withImports = files.map((f) => ({
      ...f,
      content: f.path.endsWith('.spec.ts')
        ? CodegenNormalizer.normalizeSpecImports(f.content, f.path)
        : f.content,
    }));

    if (!canonicalPomsEnabled() || !CodegenNormalizer.touchesAutomationExercise(withImports, options)) {
      return withImports;
    }

    console.log(
      '\x1b[33m[CodegenNormalizer] WEBPILOT_CANONICAL_POMS=1 — applying legacy canonical automationexercise POMs.\x1b[0m'
    );

    const pathsPresent = new Set(withImports.map((f) => f.path.replace(/\\/g, '/')));
    const normalized: GeneratedFile[] = [];

    if (ensureFrameworkTsConfig()) {
      console.log('\x1b[32m[CodegenNormalizer] Wrote tsconfig.json with @core/@config path aliases.\x1b[0m');
    }

    normalized.push({
      path: FRAMEWORK_BASE_PAGE_REL_PATH,
      content: resolveFrameworkBasePageContent(),
    });
    pathsPresent.add(FRAMEWORK_BASE_PAGE_REL_PATH);

    for (const [canonicalPath, content] of Object.entries(CANONICAL_PAGE_CONTENT)) {
      normalized.push({ path: canonicalPath, content });
      pathsPresent.add(canonicalPath);
    }

    const canonicalSpec =
      options?.testSlug && CANONICAL_SPEC_BY_SLUG[options.testSlug]
        ? CANONICAL_SPEC_BY_SLUG[options.testSlug]
        : undefined;

    for (const file of withImports) {
      const filePath = file.path.replace(/\\/g, '/');
      if (AUTOMATION_EXERCISE_CANONICAL_PATHS.has(filePath)) {
        continue;
      }
      if (filePath.endsWith('.spec.ts')) {
        if (canonicalSpec) {
          normalized.push({ path: canonicalSpec.path, content: canonicalSpec.content });
          pathsPresent.add(canonicalSpec.path);
          continue;
        }
        normalized.push(file);
      } else {
        normalized.push(file);
      }
    }

    if (canonicalSpec && !pathsPresent.has(canonicalSpec.path)) {
      normalized.push({ path: canonicalSpec.path, content: canonicalSpec.content });
    }

    const pomCount = Object.keys(CANONICAL_PAGE_CONTENT).length;
    console.log(
      `\x1b[32m[CodegenNormalizer] Applied canonical automationexercise POMs (${pomCount} files)` +
        (canonicalSpec ? ` + canonical spec (${options?.testSlug})` : '') +
        '.\x1b[0m'
    );
    return normalized;
  }

  /** Specs under test-framework/tests (including nested site folders) import sibling pages/. */
  public static normalizeSpecImports(content: string, specPath?: string): string {
    const pagesImport = (suffix: string): string => {
      const normalizedSuffix = suffix.replace(/\.tsx?$/, '');
      if (!specPath) {
        return `../pages/${normalizedSuffix}`;
      }
      const from = normalizeProjectRelativePath(specPath);
      const testsIdx = from.lastIndexOf('/tests/');
      const pagesTarget =
        testsIdx >= 0
          ? `${from.slice(0, testsIdx)}/pages/${normalizedSuffix}`
          : `packages/test-framework/pages/${normalizedSuffix}`;
      return relativeImportPath(from, `${pagesTarget}.ts`);
    };

    return content
      .replace(
        /from\s+['"](?:\.\.\/)+pages\/([^'"]+)['"]/g,
        (_match, suffix: string) => `from '${pagesImport(suffix)}'`
      )
      .replace(
        /from\s+['"]@pages\/([^'"]+)['"]/g,
        (_match, suffix: string) => `from '${pagesImport(suffix)}'`
      )
      .replace(
        /from\s+['"]\.\/pages\/([^'"]+)['"]/g,
        (_match, suffix: string) => `from '${pagesImport(suffix)}'`
      )
      .replace(/toHaveCountGreaterThan/g, 'assertCountAtLeast');
  }

  public static sanitizeGeneratedFiles(files: GeneratedFile[]): GeneratedFile[] {
    return files.map((file) => {
      const normalizedPath = file.path.replace(/\\/g, '/');
      if (!normalizedPath.endsWith('.spec.ts')) {
        return file;
      }
      return {
        ...file,
        content: CodegenNormalizer.normalizeSpecImports(file.content, file.path),
      };
    });
  }

  public static isCanonicalPagePath(filePath: string): boolean {
    return AUTOMATION_EXERCISE_CANONICAL_PATHS.has(filePath.replace(/\\/g, '/'));
  }
}
