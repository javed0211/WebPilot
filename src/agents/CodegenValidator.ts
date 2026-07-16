import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { LLMClient, LLMMessage } from '../core/LLMClient';
import { CodegenContext } from '../core/CodegenContext';
import { PromptLoader } from '../core/PromptLoader';
import { GeneratedFile } from './CodegenAgent';
import { CodegenSanitizer } from '../core/CodegenSanitizer';
import { CodegenNormalizer } from '../core/CodegenNormalizer';
import { ensureFrameworkTsConfig, FRAMEWORK_BASE_PAGE_REL_PATH } from '../core/FrameworkTemplates';

export interface ValidationIssue {
  file: string;
  line: number;
  column: number;
  message: string;
  code: number;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Validates generated TypeScript with the compiler API and optionally auto-fixes via LLM.
 */
export class CodegenValidator {
  private static readonly TS_CONFIG = path.join(process.cwd(), 'tsconfig.json');
  private static readonly MAX_FIX_ROUNDS = 2;
  private static readonly FRAMEWORK_PATH_MARKERS = [
    FRAMEWORK_BASE_PAGE_REL_PATH.replace(/\\/g, '/'),
    'packages/test-framework/core/BasePage.ts',
  ];

  private static isFrameworkBasePage(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return CodegenValidator.FRAMEWORK_PATH_MARKERS.some(
      (marker) => normalized === marker || normalized.endsWith('/BasePage.ts')
    );
  }

  public static validateFiles(relativePaths: string[]): ValidationResult {
    ensureFrameworkTsConfig();
    const configPath = CodegenValidator.TS_CONFIG;
    if (!fs.existsSync(configPath)) {
      return { valid: true, issues: [] };
    }

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath)
    );

    const absolutePaths = relativePaths
      .map((p) => path.join(process.cwd(), p))
      .filter((p) => fs.existsSync(p));

    if (absolutePaths.length === 0) {
      return { valid: true, issues: [] };
    }

    const rootNames = parsed.fileNames.length > 0 ? parsed.fileNames : absolutePaths;
    const program = ts.createProgram(rootNames, parsed.options);
    const targetSet = new Set(absolutePaths.map((p) => path.normalize(p)));
    const issues: ValidationIssue[] = [];

    for (const diag of ts.getPreEmitDiagnostics(program)) {
      const diagFile = diag.file?.fileName;
      if (!diagFile || !targetSet.has(path.normalize(diagFile))) {
        continue;
      }
      const sourcePath = diagFile;

      if (diag.file && diag.start !== undefined) {
        const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);
        issues.push({
          file: path.relative(process.cwd(), sourcePath),
          line: line + 1,
          column: character + 1,
          message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
          code: diag.code,
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }

  public static async validateAndFix(
    files: GeneratedFile[],
    llm: LLMClient
  ): Promise<{ valid: boolean; files: GeneratedFile[]; issues: ValidationIssue[] }> {
    ensureFrameworkTsConfig();
    let currentFiles = CodegenSanitizer.applyDeterministicFixes([...files]);

    for (let round = 0; round <= CodegenValidator.MAX_FIX_ROUNDS; round++) {
      const paths = currentFiles.map((f) => f.path);
      const result = CodegenValidator.validateFiles(paths);

      if (result.valid) {
        if (round > 0) {
          console.log(`\x1b[32m[CodegenValidator] All generated files pass TypeScript checks.\x1b[0m`);
        }
        return { valid: true, files: currentFiles, issues: [] };
      }

      console.warn(
        `\x1b[33m[CodegenValidator] Found ${result.issues.length} TypeScript issue(s) in generated code.\x1b[0m`
      );
      result.issues.forEach((i) => {
        console.warn(`  - ${i.file}:${i.line}:${i.column} TS${i.code}: ${i.message}`);
      });

      if (round === CodegenValidator.MAX_FIX_ROUNDS) {
        return { valid: false, files: currentFiles, issues: result.issues };
      }

      // Framework BasePage issues are almost always tsconfig/lib — heal and retry before LLM.
      const onlyFrameworkIssues = result.issues.every((issue) =>
        CodegenValidator.isFrameworkBasePage(issue.file)
      );
      if (onlyFrameworkIssues) {
        ensureFrameworkTsConfig();
        const retry = CodegenValidator.validateFiles(paths);
        if (retry.valid) {
          console.log(
            `\x1b[32m[CodegenValidator] Framework BasePage issues resolved after tsconfig/DOM heal.\x1b[0m`
          );
          return { valid: true, files: currentFiles, issues: [] };
        }
      }

      console.log(`\x1b[34m[CodegenValidator] Attempting LLM auto-fix (round ${round + 1})...\x1b[0m`);
      const fixed = await CodegenValidator.requestFix(currentFiles, result.issues, llm);
      if (!fixed || fixed.length === 0) {
        const deterministic = CodegenSanitizer.applyDeterministicFixes(currentFiles);
        const retry = CodegenValidator.validateFiles(deterministic.map((f) => f.path));
        if (retry.valid) {
          console.log(
            `\x1b[32m[CodegenValidator] Deterministic repairs resolved errors after LLM auto-fix was unavailable.\x1b[0m`
          );
          return { valid: true, files: deterministic, issues: [] };
        }
        return { valid: false, files: currentFiles, issues: result.issues };
      }
      // Merge LLM fixes onto current set (LLM may omit unchanged/framework files).
      const byPath = new Map(currentFiles.map((f) => [f.path.replace(/\\/g, '/'), f]));
      for (const file of fixed) {
        byPath.set(file.path.replace(/\\/g, '/'), file);
      }
      currentFiles = CodegenSanitizer.applyDeterministicFixes(Array.from(byPath.values()));
      currentFiles = CodegenNormalizer.sanitizeGeneratedFiles(currentFiles);
      for (const file of currentFiles) {
        const fullPath = path.join(process.cwd(), file.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.content, 'utf8');
      }
    }

    return { valid: false, files: currentFiles, issues: [] };
  }

  private static extractJsonObject(text: string): string {
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```$/m, '').trim();
    }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return cleaned.slice(start, end + 1);
    }
    return cleaned;
  }

  private static async requestFix(
    files: GeneratedFile[],
    issues: ValidationIssue[],
    llm: LLMClient
  ): Promise<GeneratedFile[] | null> {
    const fixableIssues = issues.filter((i) => !CodegenValidator.isFrameworkBasePage(i.file));
    if (fixableIssues.length === 0) {
      console.warn(
        '[CodegenValidator] Skipping LLM auto-fix — remaining issues are in framework BasePage (fix tsconfig lib/DOM).'
      );
      return null;
    }

    const issuesText = fixableIssues
      .map((i) => `${i.file}:${i.line}:${i.column} TS${i.code}: ${i.message}`)
      .join('\n');

    // Never ask the LLM to rewrite BasePage — it is huge and causes truncated JSON.
    const fixableFiles = files.filter((f) => !CodegenValidator.isFrameworkBasePage(f.path));
    const filesText = fixableFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');

    const systemPrompt = PromptLoader.loadWithVars('codegen-fix/typescript-system.md', {
      guidelines: CodegenContext.loadGuidelines(),
      base_page_api: CodegenContext.buildBasePageApiSummary(),
      repo_knowledge: CodegenContext.knowledgeForEdit(),
    });

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Compiler errors:\n${issuesText}\n\nFiles to fix:\n${filesText}`,
      },
    ];

    const fixLlm =
      llm instanceof LLMClient
        ? new LLMClient({ maxTokens: 16000 })
        : llm;

    try {
      const response = await fixLlm.complete(messages);
      const cleaned = CodegenValidator.extractJsonObject(response.text);
      const parsed = JSON.parse(cleaned) as { files: GeneratedFile[] };
      return parsed.files ?? null;
    } catch (err) {
      console.error('[CodegenValidator] Auto-fix parse failed:', err);
      return null;
    }
  }
}
