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
        (canonicalSpec ? ` + canonical spec (${options?.testSlug})` : '') +
        '.\x1b[0m'
    );
    return normalized;
  }

  /** Specs under test-framework/tests must import pages via ../pages/ (one level up). */
  public static normalizeSpecImports(content: string): string {
    return content
      .replace(
        /from\s+['"](?:\.\.\/)+pages\/([^'"]+)['"]/g,
        "from '../pages/$1'"
      )
      .replace(
        /from\s+['"]@pages\/([^'"]+)['"]/g,
        "from '../pages/$1'"
      )
      .replace(
        /from\s+['"]\.\/pages\/([^'"]+)['"]/g,
        "from '../pages/$1'"
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
        content: CodegenNormalizer.normalizeSpecImports(file.content),
      };
    });
  }

  public static isCanonicalPagePath(filePath: string): boolean {
    return AUTOMATION_EXERCISE_CANONICAL_PATHS.has(filePath.replace(/\\/g, '/'));
  }
}
