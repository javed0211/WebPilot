import * as fs from 'fs';
import * as path from 'path';
import { GeneratedFile } from '../agents/CodegenAgent';
import { CodegenNormalizer, NormalizeOptions } from './CodegenNormalizer';
import { FRAMEWORK_BASE_PAGE_REL_PATH } from './FrameworkTemplates';

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function resolveImportPath(specPath: string, importSpecifier: string): string {
  const normalized = importSpecifier.replace(/\\/g, '/').replace(/\.ts$/, '');
  if (normalized.startsWith('@pages/')) {
    return `packages/test-framework/pages/${normalized.slice('@pages/'.length)}.ts`;
  }
  if (normalized.startsWith('@core/')) {
    return `packages/test-framework/core/${normalized.slice('@core/'.length)}.ts`;
  }
  if (normalized.startsWith('@config/')) {
    return `packages/test-framework/config/${normalized.slice('@config/'.length)}.ts`;
  }

  const specDir = path.posix.dirname(normalizePath(specPath));
  let resolved = path.posix.normalize(path.posix.join(specDir, normalized));
  if (!resolved.endsWith('.ts')) {
    resolved += '.ts';
  }
  return resolved;
}

export function parseSpecImports(
  specContent: string,
  specPath: string
): Array<{ className: string; resolvedPath: string; importFrom: string }> {
  const imports: Array<{ className: string; resolvedPath: string; importFrom: string }> = [];
  const importRe = /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(specContent)) !== null) {
    const className = match[1].trim().split(',')[0]?.trim();
    const importFrom = match[2].trim();
    if (!className || className === 'test' || className === 'expect') {
      continue;
    }
    imports.push({
      className,
      importFrom,
      resolvedPath: resolveImportPath(specPath, importFrom),
    });
  }
  return imports;
}

/**
 * Expands generated output with canonical POMs, BasePage, and spec import dependencies
 * so validation runs against the same files Playwright will execute.
 */
export class CodegenValidationBundle {
  public static expand(files: GeneratedFile[], options?: NormalizeOptions): GeneratedFile[] {
    const bundle = CodegenNormalizer.normalize(files, options);
    const byPath = new Map(bundle.map((file) => [normalizePath(file.path), file]));

    for (const file of bundle) {
      if (!file.path.endsWith('.spec.ts')) {
        continue;
      }
      for (const imp of parseSpecImports(file.content, file.path)) {
        if (byPath.has(imp.resolvedPath)) {
          continue;
        }
        const diskPath = path.join(process.cwd(), imp.resolvedPath);
        if (fs.existsSync(diskPath)) {
          byPath.set(imp.resolvedPath, {
            path: imp.resolvedPath,
            content: fs.readFileSync(diskPath, 'utf8'),
          });
        }
      }
    }

    if (!byPath.has(FRAMEWORK_BASE_PAGE_REL_PATH)) {
      const basePath = path.join(process.cwd(), FRAMEWORK_BASE_PAGE_REL_PATH);
      if (fs.existsSync(basePath)) {
        byPath.set(FRAMEWORK_BASE_PAGE_REL_PATH, {
          path: FRAMEWORK_BASE_PAGE_REL_PATH,
          content: fs.readFileSync(basePath, 'utf8'),
        });
      }
    }

    return [...byPath.values()];
  }
}
