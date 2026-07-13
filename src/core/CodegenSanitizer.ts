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

  private static isFullPageObject(content: string): boolean {
    return /extends\s+(BasePage|AutomationExerciseBasePage)/.test(content);
  }

  private static incomingMethodNames(incomingContent: string): string[] {
    const names: string[] = [];
    const methodRe = /public\s+async\s+(\w+)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = methodRe.exec(incomingContent)) !== null) {
      names.push(match[1]);
    }
    return names;
  }

  private static existingDefinesMethods(existingContent: string, methodNames: string[]): boolean {
    if (methodNames.length === 0) {
      return true;
    }
    return methodNames.every((name) => new RegExp(`\\b${name}\\s*\\(`).test(existingContent));
  }

  private static appendPartialMethods(existingContent: string, incomingContent: string): string | null {
    const methodBlocks = incomingContent.match(
      /public\s+async\s+\w+\s*\(\)\s*:\s*Promise<void>\s*\{[\s\S]*?\n\s*\}/g
    );
    if (!methodBlocks?.length) {
      return null;
    }
    const newBlocks = methodBlocks.filter((block) => {
      const nameMatch = block.match(/public\s+async\s+(\w+)\s*\(/);
      return nameMatch && !new RegExp(`\\b${nameMatch[1]}\\s*\\(`).test(existingContent);
    });
    if (newBlocks.length === 0) {
      return existingContent;
    }
    const closingBrace = existingContent.lastIndexOf('}');
    if (closingBrace === -1) {
      return null;
    }
    const candidate = `${existingContent.slice(0, closingBrace)}\n\n${newBlocks.join('\n\n')}\n${existingContent.slice(closingBrace)}`;
    return CodegenSanitizer.isParsableTypeScript(candidate) ? candidate : null;
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

    const repairedMerge = CodegenSanitizer.repairTruncatedSource(mergedContent);
    if (
      repairedMerge !== mergedContent &&
      CodegenSanitizer.isParsableTypeScript(repairedMerge)
    ) {
      console.warn(
        `\x1b[33m[CodegenSanitizer] Repaired invalid AST merge for ${filePath}.\x1b[0m`
      );
      return repairedMerge;
    }

    if (CodegenSanitizer.isParsableTypeScript(incomingContent)) {
      if (CodegenSanitizer.isFullPageObject(incomingContent)) {
        console.warn(
          `\x1b[33m[CodegenSanitizer] AST merge failed for ${filePath}; replacing with incoming page object.\x1b[0m`
        );
        return incomingContent;
      }
    }

    try {
      const existing = fs.readFileSync(existingPath, 'utf8');
      const incomingMethods = CodegenSanitizer.incomingMethodNames(incomingContent);
      if (CodegenSanitizer.isParsableTypeScript(existing)) {
        const appended = CodegenSanitizer.appendPartialMethods(existing, incomingContent);
        if (appended && appended !== existing) {
          console.warn(
            `\x1b[33m[CodegenSanitizer] AST merge failed for ${filePath}; appended ${incomingMethods.length} new method(s) to existing page object.\x1b[0m`
          );
          return appended;
        }
        if (CodegenSanitizer.existingDefinesMethods(existing, incomingMethods)) {
          console.warn(
            `\x1b[33m[CodegenSanitizer] AST merge produced invalid TS for ${filePath}; keeping existing file (methods already present).\x1b[0m`
          );
          return existing;
        }
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
