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
import { ensureFrameworkTsConfig } from './FrameworkTemplates';
import { CodegenValidationBundle } from './CodegenValidationBundle';
import { CodegenReferenceValidator } from './CodegenReferenceValidator';

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

  private static isStubPageObject(content: string): boolean {
    return !/(?:public\s+)?async\s+\w+\s*\(/.test(content);
  }

  private static isFullPageObject(content: string): boolean {
    return /extends\s+(BasePage|AutomationExerciseBasePage)/.test(content);
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
          const existingContent = fs.readFileSync(fullPath, 'utf8');
          const replaceStub =
            CodegenWriter.isStubPageObject(existingContent) && CodegenWriter.isFullPageObject(file.content);
          if (replaceStub) {
            console.log(`\x1b[32m[Codegen] Replacing stub Page Object: ${file.path}\x1b[0m`);
            fs.writeFileSync(fullPath, file.content, 'utf8');
          } else {
            console.log(`\x1b[33m[AST Merger] Merging into: ${file.path}\x1b[0m`);
            const mergedContent = ASTMerger.mergeClassContent(fullPath, file.content);
            const safeContent = CodegenSanitizer.chooseMergeContent(
              file.path,
              fullPath,
              file.content,
              mergedContent
            );
            fs.writeFileSync(fullPath, safeContent, 'utf8');
          }
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
    if (ensureFrameworkTsConfig()) {
      console.log('\x1b[32m[CodegenWriter] Wrote tsconfig.json with @core/@config path aliases.\x1b[0m');
    }
    const normalized = CodegenNormalizer.normalize(files, normalizeOptions);
    CodegenWriter.ensureSiteScaffolds(normalized);
    const bundle = CodegenValidationBundle.expand(normalized, normalizeOptions);
    const paths = CodegenWriter.writeFiles(bundle);
    if (paths.length === 0) {
      console.error(`\x1b[31m[CodegenWriter] No files written.\x1b[0m`);
      return { ok: false, paths: [] };
    }

    let onDisk = CodegenSanitizer.applyDeterministicFixes(CodegenWriter.readFilesFromDisk(paths));

    const sanitizedChanged = onDisk.some(
      (f, i) => f.content !== fs.readFileSync(path.join(process.cwd(), paths[i]), 'utf8')
    );
    if (sanitizedChanged) {
      // Force overwrite — do not AST-merge sanitizer repairs into the truncated originals
      // that were just written (merge-on-repair was collapsing POMs into import-only stubs).
      for (const file of onDisk) {
        const fullPath = path.join(process.cwd(), file.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.content, 'utf8');
      }
      onDisk = CodegenWriter.readFilesFromDisk(paths);
    }

    let reference = CodegenReferenceValidator.validate(onDisk);
    if (
      !reference.valid &&
      reference.issues.some((issue) => issue.code === 'stub_page_object') &&
      CodegenNormalizer.touchesAutomationExercise(onDisk, normalizeOptions)
    ) {
      console.log(
        '\x1b[33m[CodegenReferenceValidator] Stub page object detected — re-applying canonical automationexercise POMs.\x1b[0m'
      );
      onDisk = CodegenValidationBundle.expand(onDisk, normalizeOptions);
      CodegenWriter.writeFiles(onDisk);
      onDisk = CodegenWriter.readFilesFromDisk(onDisk.map((file) => file.path));
      reference = CodegenReferenceValidator.validate(onDisk);
    }
    if (!reference.valid) {
      console.error(`\x1b[31m[CodegenReferenceValidator] Generated code has reference issues.\x1b[0m`);
      reference.issues.forEach((issue) => {
        console.error(`  - ${issue.file}: ${issue.message}`);
      });
      return { ok: false, paths };
    }
    console.log(
      `\x1b[32m[CodegenReferenceValidator] Import and method references are valid (${onDisk.length} file(s)).\x1b[0m`
    );

    console.log(`\x1b[34m[CodegenValidator] Running TypeScript checks on ${onDisk.length} file(s)...\x1b[0m`);
    const { valid, files: fixedFiles, issues } = await CodegenValidator.validateAndFix(onDisk, llm);

    if (!valid) {
      console.error(
        `\x1b[31m[CodegenValidator] Generated code still has errors after auto-fix.\x1b[0m`
      );
      issues.forEach((i) => console.error(`  ${i.file}:${i.line} — ${i.message}`));
      return { ok: false, paths };
    }

    let finalFiles = CodegenValidationBundle.expand(fixedFiles, normalizeOptions);
    if (finalFiles.some((f, i) => f.content !== fixedFiles[i]?.content)) {
      CodegenWriter.writeFiles(finalFiles);
      finalFiles = CodegenWriter.readFilesFromDisk(finalFiles.map((f) => f.path));
    }

    const postTsReference = CodegenReferenceValidator.validate(finalFiles);
    if (!postTsReference.valid) {
      console.error(`\x1b[31m[CodegenReferenceValidator] TypeScript fixes introduced reference issues.\x1b[0m`);
      postTsReference.issues.forEach((issue) => {
        console.error(`  - ${issue.file}: ${issue.message}`);
      });
      return { ok: false, paths };
    }

    const hasSpec = finalFiles.some((f) => f.path.endsWith('.spec.ts'));
    if (hasSpec) {
      console.log(`\x1b[34m[CodegenPlaywrightValidator] Running generated Playwright spec(s)...\x1b[0m`);
      const pw = await CodegenPlaywrightValidator.validateAndFix(finalFiles, llm, normalizeOptions);
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
