import * as fs from 'fs';
import * as ts from 'typescript';
import { GeneratedFile } from '../agents/CodegenAgent';

/**
 * Deterministic repairs for common codegen/AST-merge failures before LLM auto-fix.
 */
export class CodegenSanitizer {
  public static isParsableTypeScript(content: string): boolean {
    const result = ts.transpileModule(content, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
      reportDiagnostics: true,
    });
    return !result.diagnostics?.length;
  }

  public static repairTruncatedSource(content: string): string {
    if (CodegenSanitizer.isParsableTypeScript(content)) {
      return content;
    }
    const lines = content.split('\n');
    for (let end = lines.length; end > 1; end--) {
      const candidate = lines.slice(0, end).join('\n');
      if (CodegenSanitizer.isParsableTypeScript(candidate)) {
        return candidate.endsWith('\n') ? candidate : `${candidate}\n`;
      }
    }
    return content;
  }

  public static applyDeterministicFixes(files: GeneratedFile[]): GeneratedFile[] {
    return files.map((file) => {
      let content = file.content;

      content = content
        .replace(/from\s+['"]@src\/core\/BasePage['"]/g, "from '@core/BasePage'")
        .replace(/from\s+['"]\.\.\/\.\.\/BasePage['"]/g, "from '@core/BasePage'")
        .replace(/from\s+['"]\.\.\/BasePage['"]/g, "from '@core/BasePage'")
        .replace(/from\s+['"]\.\.\/core\/BasePage['"]/g, "from '@core/BasePage'");

      if (!CodegenSanitizer.isParsableTypeScript(content)) {
        const repaired = CodegenSanitizer.repairTruncatedSource(content);
        if (repaired !== content && CodegenSanitizer.isParsableTypeScript(repaired)) {
          console.warn(
            `\x1b[33m[CodegenSanitizer] Repaired truncated syntax in ${file.path}\x1b[0m`
          );
          content = repaired;
        }
      }

      return content === file.content ? file : { ...file, content };
    });
  }

  public static chooseMergeContent(
    filePath: string,
    existingPath: string,
    incomingContent: string,
    mergedContent: string
  ): string {
    if (CodegenSanitizer.isParsableTypeScript(mergedContent)) {
      return mergedContent;
    }
    try {
      const existing = fs.readFileSync(existingPath, 'utf8');
      if (CodegenSanitizer.isParsableTypeScript(existing)) {
        console.warn(
          `\x1b[33m[CodegenSanitizer] AST merge produced invalid TS for ${filePath}; keeping existing file.\x1b[0m`
        );
        return existing;
      }
    } catch {
      /* ignore */
    }
    if (CodegenSanitizer.isParsableTypeScript(incomingContent)) {
      console.warn(
        `\x1b[33m[CodegenSanitizer] AST merge produced invalid TS for ${filePath}; using incoming codegen only.\x1b[0m`
      );
      return incomingContent;
    }
    return CodegenSanitizer.repairTruncatedSource(mergedContent);
  }
}
