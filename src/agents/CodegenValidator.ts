import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { LLMClient, LLMMessage } from '../core/LLMClient';
import { CodegenContext } from '../core/CodegenContext';
import { PromptLoader } from '../core/PromptLoader';
import { GeneratedFile } from './CodegenAgent';
import { CodegenSanitizer } from '../core/CodegenSanitizer';
import { CodegenNormalizer } from '../core/CodegenNormalizer';

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

  public static validateFiles(relativePaths: string[]): ValidationResult {
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
      currentFiles = CodegenSanitizer.applyDeterministicFixes(fixed);
      currentFiles = CodegenNormalizer.sanitizeGeneratedFiles(currentFiles);
      for (const file of currentFiles) {
        const fullPath = path.join(process.cwd(), file.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.content, 'utf8');
      }
    }

    return { valid: false, files: currentFiles, issues: [] };
  }

  private static async requestFix(
    files: GeneratedFile[],
    issues: ValidationIssue[],
    llm: LLMClient
  ): Promise<GeneratedFile[] | null> {
    const issuesText = issues
      .map((i) => `${i.file}:${i.line}:${i.column} TS${i.code}: ${i.message}`)
      .join('\n');

    const filesText = files
      .map((f) => `--- ${f.path} ---\n${f.content}`)
      .join('\n\n');

    const systemPrompt = PromptLoader.loadWithVars('codegen-fix/typescript-system.md', {
      guidelines: CodegenContext.loadGuidelines(),
      base_page_api: CodegenContext.buildBasePageApiSummary(),
    });

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Compiler errors:\n${issuesText}\n\nFiles to fix:\n${filesText}`,
      },
    ];

    try {
      const response = await llm.complete(messages);
      let cleaned = response.text.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```json\s*/, '').replace(/```$/, '');
      }
      const parsed = JSON.parse(cleaned.trim()) as { files: GeneratedFile[] };
      return parsed.files ?? null;
    } catch (err) {
      console.error('[CodegenValidator] Auto-fix parse failed:', err);
      return null;
    }
  }
}
