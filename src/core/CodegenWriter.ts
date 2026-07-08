import * as fs from 'fs';
import * as path from 'path';
import { GeneratedFile } from '../agents/CodegenAgent';
import { CodegenValidator } from '../agents/CodegenValidator';
import { ASTMerger } from './SymbolParser';
import { LLMClient } from './LLMClient';
import { UsageTracker } from '../utils/UsageTracker';
import { CodegenNormalizer, NormalizeOptions } from './CodegenNormalizer';
import { CodegenPlaywrightValidator } from './CodegenPlaywrightValidator';
import { CodegenSanitizer } from './CodegenSanitizer';
import { AUTOMATION_EXERCISE_BASE_PAGE } from './CodegenCanonicalPages';

const MONOLITHIC_PAGE_DENYLIST = ['AutomationExercisePage.ts'];

/**
 * Persists generated files with AST merge, canonical POM injection, TS + Playwright validation.
 */
export class CodegenWriter {
  /** Ensure site base POM exists before merging route-specific pages. */
  public static ensureSiteScaffolds(files: GeneratedFile[]): void {
    const touchesAutomationExercise = files.some((f) =>
      f.path.includes('automationexercise')
    );
    if (!touchesAutomationExercise) {
      return;
    }
    const basePath = path.join(
      process.cwd(),
      'packages/test-framework/pages/automationexercise/AutomationExerciseBasePage.ts'
    );
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(path.dirname(basePath), { recursive: true });
      fs.writeFileSync(basePath, AUTOMATION_EXERCISE_BASE_PAGE, 'utf8');
      console.log(
        `\x1b[32m[Codegen] Scaffolded site base Page Object: packages/test-framework/pages/automationexercise/AutomationExerciseBasePage.ts\x1b[0m`
      );
    }
  }

  private static isPageObjectPath(filePath: string): boolean {
    return filePath.startsWith('packages/test-framework/pages/') && filePath.endsWith('.ts');
  }

  private static rejectMonolithicPage(file: GeneratedFile): boolean {
    const base = path.basename(file.path);
    if (MONOLITHIC_PAGE_DENYLIST.includes(base)) {
      console.error(
        `\x1b[31m[CodegenWriter] Rejected monolithic page "${file.path}". ` +
          `Split into per-route pages under packages/test-framework/pages/<site>/ (see prompts/shared/framework-guidelines.md).\x1b[0m`
      );
      return true;
    }
    return false;
  }

  private static resolvePageFilePath(file: GeneratedFile): string {
    const classMatch = file.content.match(/export\s+class\s+(\w+)/);
    const identityMatch = file.content.match(/@pageIdentity\s+(\w+)/);
    const className = identityMatch?.[1] || classMatch?.[1];
    if (!className) {
      return file.path;
    }
    if (file.path.includes('automationexercise') || className.startsWith('AutomationExercise')) {
      return `packages/test-framework/pages/automationexercise/${className}.ts`;
    }
    return `packages/test-framework/pages/${className}.ts`;
  }

  private static classNameMatchesFile(filePath: string, content: string): boolean {
    const expected = path.basename(filePath, '.ts');
    const classMatch = content.match(/export\s+class\s+(\w+)/);
    const identityMatch = content.match(/@pageIdentity\s+(\w+)/);
    const actual = identityMatch?.[1] || classMatch?.[1];
    return !actual || actual === expected;
  }

  public static writeFiles(files: GeneratedFile[]): string[] {
    const written: string[] = [];

    for (let file of files) {
      if (CodegenWriter.rejectMonolithicPage(file)) {
        continue;
      }

      if (CodegenWriter.isPageObjectPath(file.path)) {
        file = { ...file, path: CodegenWriter.resolvePageFilePath(file) };
        if (!CodegenWriter.classNameMatchesFile(file.path, file.content)) {
          console.warn(
            `\x1b[33m[CodegenWriter] Class name in content does not match file ${file.path}; merge may be unsafe.\x1b[0m`
          );
        }
      }

      const fullPath = path.join(process.cwd(), file.path);
      const isCanonical = CodegenNormalizer.isCanonicalPagePath(file.path);

      if (CodegenWriter.isPageObjectPath(file.path)) {
        if (fs.existsSync(fullPath) && !isCanonical) {
          console.log(`\x1b[33m[AST Merger] Merging into: ${file.path}\x1b[0m`);
          const mergedContent = ASTMerger.mergeClassContent(fullPath, file.content);
          const safeContent = CodegenSanitizer.chooseMergeContent(
            file.path,
            fullPath,
            file.content,
            mergedContent
          );
          fs.writeFileSync(fullPath, safeContent, 'utf8');
        } else {
          console.log(`\x1b[32m[Codegen] Writing Page Object: ${file.path}\x1b[0m`);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, file.content, 'utf8');
        }
      } else {
        console.log(`\x1b[32m[Codegen] Writing file: ${file.path}\x1b[0m`);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.content, 'utf8');
      }
      written.push(file.path);
    }

    return written;
  }

  public static readFilesFromDisk(paths: string[]): GeneratedFile[] {
    return paths.map((p) => ({
      path: p,
      content: fs.readFileSync(path.join(process.cwd(), p), 'utf8'),
    }));
  }

  public static async writeAndValidate(
    files: GeneratedFile[],
    llm: LLMClient,
    normalizeOptions?: NormalizeOptions
  ): Promise<{ ok: boolean; paths: string[] }> {
    UsageTracker.setPhase('codegen');
    const normalized = CodegenNormalizer.normalize(files, normalizeOptions);
    CodegenWriter.ensureSiteScaffolds(normalized);
    const paths = CodegenWriter.writeFiles(normalized);
    if (paths.length === 0) {
      console.error(`\x1b[31m[CodegenWriter] No files written.\x1b[0m`);
      return { ok: false, paths: [] };
    }

    let onDisk = CodegenSanitizer.applyDeterministicFixes(CodegenWriter.readFilesFromDisk(paths));
    const sanitizedChanged = onDisk.some(
      (f, i) => f.content !== fs.readFileSync(path.join(process.cwd(), paths[i]), 'utf8')
    );
    if (sanitizedChanged) {
      CodegenWriter.writeFiles(onDisk);
      onDisk = CodegenWriter.readFilesFromDisk(paths);
    }

    console.log(`\x1b[34m[CodegenValidator] Running TypeScript checks on ${paths.length} file(s)...\x1b[0m`);
    const { valid, files: fixedFiles, issues } = await CodegenValidator.validateAndFix(onDisk, llm);

    if (!valid) {
      console.error(
        `\x1b[31m[CodegenValidator] Generated code still has errors after auto-fix.\x1b[0m`
      );
      issues.forEach((i) => console.error(`  ${i.file}:${i.line} — ${i.message}`));
      return { ok: false, paths };
    }

    let finalFiles = fixedFiles;
    if (fixedFiles.some((f, i) => f.content !== onDisk[i]?.content)) {
      CodegenWriter.writeFiles(fixedFiles);
      finalFiles = CodegenWriter.readFilesFromDisk(paths);
    }

    const hasSpec = finalFiles.some((f) => f.path.endsWith('.spec.ts'));
    if (hasSpec) {
      console.log(`\x1b[34m[CodegenPlaywrightValidator] Running generated Playwright spec(s)...\x1b[0m`);
      const pw = await CodegenPlaywrightValidator.validateAndFix(finalFiles, llm);
      if (!pw.passed) {
        console.error(
          `\x1b[31m[CodegenPlaywrightValidator] Generated spec(s) failed Playwright after auto-fix.\x1b[0m`
        );
        return { ok: false, paths };
      }
      const afterPlaywright = CodegenNormalizer.normalize(pw.files, normalizeOptions);
      if (afterPlaywright.some((f, i) => f.content !== pw.files[i]?.content)) {
        CodegenWriter.writeFiles(afterPlaywright);
      }
    }

    return { ok: true, paths };
  }
}
