import { GeneratedFile } from '../agents/CodegenAgent';
import {
  AUTOMATION_EXERCISE_CANONICAL_PATHS,
  loadCanonicalPageContent,
} from './CodegenCanonicalPages';

export interface NormalizeOptions {
  testSlug?: string;
  urls?: string[];
}

export class CodegenNormalizer {
  public static touchesAutomationExercise(
    files: GeneratedFile[],
    options?: NormalizeOptions
  ): boolean {
    return Boolean(
      options?.testSlug?.includes('automationexercise') ||
        options?.urls?.some((url) => url.includes('automationexercise.com')) ||
        files.some(
          (file) =>
            file.path.includes('automationexercise') ||
            file.content.includes('automationexercise.com')
        )
    );
  }

  public static normalize(
    files: GeneratedFile[],
    options?: NormalizeOptions
  ): GeneratedFile[] {
    const normalized = files.map((file) => ({
      ...file,
      path: CodegenNormalizer.normalizePath(file.path),
      content: CodegenNormalizer.normalizeImports(file.content),
    }));
    if (!CodegenNormalizer.touchesAutomationExercise(normalized, options)) {
      return normalized;
    }
    const canonical = Object.entries(loadCanonicalPageContent()).map(([path, content]) => ({
      path,
      content,
    }));
    return [
      ...canonical,
      ...normalized.filter(
        (file) => !AUTOMATION_EXERCISE_CANONICAL_PATHS.has(file.path)
      ),
    ];
  }

  public static normalizePath(filePath: string): string {
    const path = filePath.replace(/\\/g, '/');
    if (path.endsWith('.spec.ts')) {
      const base = path.split('/').pop()!.replace(/\.spec\.ts$/, '');
      return `framework/tests/test_${CodegenNormalizer.snakeCase(base)}.py`;
    }
    if (path.startsWith('framework/pages/') && path.endsWith('.ts')) {
      const parts = path.split('/');
      const className = parts.pop()!.replace(/\.ts$/, '');
      return [...parts, `${CodegenNormalizer.snakeCase(className)}.py`].join('/');
    }
    return path;
  }

  public static normalizeImports(content: string): string {
    return content.replace(
      /from\s+framework\.pages\.automationexercise\.([A-Z]\w+)/g,
      (_match, className) =>
        `from framework.pages.automationexercise.${CodegenNormalizer.snakeCase(className)}`
    );
  }

  public static isCanonicalPagePath(filePath: string): boolean {
    return AUTOMATION_EXERCISE_CANONICAL_PATHS.has(filePath.replace(/\\/g, '/'));
  }

  private static snakeCase(value: string): string {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
  }
}
