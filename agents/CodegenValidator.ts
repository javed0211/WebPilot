import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { LLMClient, LLMMessage } from '../core/LLMClient';
import { CodegenContext } from '../core/CodegenContext';
import { PromptLoader } from '../core/PromptLoader';
import { GeneratedFile } from './CodegenAgent';

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

export class CodegenValidator {
  private static readonly MAX_FIX_ROUNDS = 2;

  private static pythonExecutable(): string {
    const venv = path.join(process.cwd(), '.venv', 'bin', 'python');
    return fs.existsSync(venv) ? venv : process.env.WEBPILOT_PYTHON || 'python3';
  }

  public static validateFiles(relativePaths: string[]): ValidationResult {
    const existing = relativePaths.filter(
      (filePath) => filePath.endsWith('.py') && fs.existsSync(path.join(process.cwd(), filePath))
    );
    if (existing.length === 0) return { valid: true, issues: [] };
    const result = spawnSync(
      CodegenValidator.pythonExecutable(),
      ['-m', 'py_compile', ...existing],
      { cwd: process.cwd(), encoding: 'utf8' }
    );
    if (result.status === 0) return { valid: true, issues: [] };
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const issuePattern = /File "([^"]+)", line (\d+)[\s\S]*?(?:SyntaxError|IndentationError): ([^\n]+)/g;
    const issues: ValidationIssue[] = [];
    for (const match of output.matchAll(issuePattern)) {
      issues.push({
        file: path.relative(process.cwd(), match[1]),
        line: Number(match[2]),
        column: 1,
        message: match[3],
        code: 1,
      });
    }
    if (issues.length === 0) {
      issues.push({ file: existing[0], line: 1, column: 1, message: output.trim(), code: 1 });
    }
    return { valid: false, issues };
  }

  public static async validateAndFix(
    files: GeneratedFile[],
    llm: LLMClient
  ): Promise<{ valid: boolean; files: GeneratedFile[]; issues: ValidationIssue[] }> {
    let currentFiles = [...files];
    for (let round = 0; round <= CodegenValidator.MAX_FIX_ROUNDS; round++) {
      const result = CodegenValidator.validateFiles(currentFiles.map((file) => file.path));
      if (result.valid) return { valid: true, files: currentFiles, issues: [] };
      if (round === CodegenValidator.MAX_FIX_ROUNDS) {
        return { valid: false, files: currentFiles, issues: result.issues };
      }
      const fixed = await CodegenValidator.requestFix(currentFiles, result.issues, llm);
      if (!fixed?.length) return { valid: false, files: currentFiles, issues: result.issues };
      currentFiles = fixed;
      currentFiles.forEach((file) => {
        const fullPath = path.join(process.cwd(), file.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.content, 'utf8');
      });
    }
    return { valid: false, files: currentFiles, issues: [] };
  }

  private static async requestFix(
    files: GeneratedFile[],
    issues: ValidationIssue[],
    llm: LLMClient
  ): Promise<GeneratedFile[] | null> {
    const systemPrompt = PromptLoader.loadWithVars('codegen-fix/python-system.md', {
      guidelines: CodegenContext.loadGuidelines(),
      base_page_api: CodegenContext.buildBasePageApiSummary(),
    });
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Python errors:\n${issues.map((issue) => `${issue.file}:${issue.line} ${issue.message}`).join('\n')}\n\nFiles:\n${files.map((file) => `--- ${file.path} ---\n${file.content}`).join('\n\n')}`,
      },
    ];
    try {
      const response = await llm.complete(messages);
      const cleaned = response.text.trim().replace(/^```json\s*/, '').replace(/```$/, '');
      return (JSON.parse(cleaned) as { files: GeneratedFile[] }).files ?? null;
    } catch (error) {
      console.error('[CodegenValidator] Auto-fix parse failed:', error);
      return null;
    }
  }
}
