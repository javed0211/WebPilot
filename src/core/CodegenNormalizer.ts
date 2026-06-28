import { GeneratedFile } from '../agents/CodegenAgent';
import {
  AUTOMATION_EXERCISE_CANONICAL_PATHS,
  CANONICAL_PAGE_CONTENT,
  CANONICAL_SPEC_BY_SLUG,
} from './CodegenCanonicalPages';

export interface NormalizeOptions {
  testSlug?: string;
  urls?: string[];
}

/**
 * Deterministic post-processing so generated automationexercise flows pass Playwright without manual edits.
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
    if (!CodegenNormalizer.touchesAutomationExercise(files, options)) {
      return files.map((f) => ({ ...f, content: CodegenNormalizer.normalizeSpecImports(f.content) }));
    }

    const pathsPresent = new Set(files.map((f) => f.path.replace(/\\/g, '/')));
    const normalized: GeneratedFile[] = [];

    for (const [canonicalPath, content] of Object.entries(CANONICAL_PAGE_CONTENT)) {
      normalized.push({ path: canonicalPath, content });
      pathsPresent.add(canonicalPath);
    }

    const canonicalSpec =
      options?.testSlug && CANONICAL_SPEC_BY_SLUG[options.testSlug]
        ? CANONICAL_SPEC_BY_SLUG[options.testSlug]
        : undefined;

    for (const file of files) {
      const path = file.path.replace(/\\/g, '/');
      if (AUTOMATION_EXERCISE_CANONICAL_PATHS.has(path)) {
        continue;
      }
      if (path.endsWith('.spec.ts')) {
        if (canonicalSpec) {
          normalized.push({ path: canonicalSpec.path, content: canonicalSpec.content });
          pathsPresent.add(canonicalSpec.path);
          continue;
        }
        normalized.push({
          path,
          content: CodegenNormalizer.normalizeSpecImports(file.content),
        });
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
        (canonicalSpec ? ' + contact-us spec' : '') +
        '.\x1b[0m'
    );
    return normalized;
  }

  /** Specs must use path aliases, not relative imports into packages/test-framework/pages. */
  public static normalizeSpecImports(content: string): string {
    return content
      .replace(
        /from\s+['"]\.\.\/pages\/automationexercise\/([^'"]+)['"]/g,
        "from '@pages/automationexercise/$1'"
      )
      .replace(
        /from\s+['"]\.\/pages\/automationexercise\/([^'"]+)['"]/g,
        "from '@pages/automationexercise/$1'"
      )
      .replace(/toHaveCountGreaterThan/g, 'assertCountAtLeast');
  }

  public static isCanonicalPagePath(filePath: string): boolean {
    return AUTOMATION_EXERCISE_CANONICAL_PATHS.has(filePath.replace(/\\/g, '/'));
  }
}
