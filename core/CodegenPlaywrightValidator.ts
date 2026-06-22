import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { GeneratedFile } from '../agents/CodegenAgent';
import { LLMClient, LLMMessage } from './LLMClient';
import { CodegenContext } from './CodegenContext';
import { PromptLoader } from './PromptLoader';

export interface PlaywrightRunResult {
  passed: boolean;
  output: string;
  specPaths: string[];
}

const MAX_PLAYWRIGHT_FIX_ROUNDS = 2;

export class CodegenPlaywrightValidator {
  private static pythonExecutable(): string {
    const venv = path.join(process.cwd(), '.venv', 'bin', 'python');
    return fs.existsSync(venv) ? venv : process.env.WEBPILOT_PYTHON || 'python3';
  }

  public static runSpecs(relativeSpecPaths: string[]): PlaywrightRunResult {
    const existing = relativeSpecPaths.filter((filePath) =>
      fs.existsSync(path.join(process.cwd(), filePath))
    );
    if (existing.length === 0) {
      return { passed: true, output: 'No Python tests to run.', specPaths: [] };
    }
    const result = spawnSync(
      CodegenPlaywrightValidator.pythonExecutable(),
      ['-m', 'pytest', ...existing, '--maxfail=1', '-q'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 180_000,
        env: { ...process.env, FORCE_COLOR: '0' },
      }
    );
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.slice(-12_000);
    return { passed: result.status === 0, output, specPaths: existing };
  }

  public static async validateAndFix(
    files: GeneratedFile[],
    llm: LLMClient
  ): Promise<{ passed: boolean; files: GeneratedFile[]; output: string }> {
    const specPaths = files
      .filter((file) => /framework\/tests\/test_.+\.py$/.test(file.path))
      .map((file) => file.path);
    let currentFiles = [...files];
    for (let round = 0; round <= MAX_PLAYWRIGHT_FIX_ROUNDS; round++) {
      currentFiles.forEach((file) => {
        const fullPath = path.join(process.cwd(), file.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.content, 'utf8');
      });
      const result = CodegenPlaywrightValidator.runSpecs(specPaths);
      if (result.passed) return { passed: true, files: currentFiles, output: result.output };
      if (round === MAX_PLAYWRIGHT_FIX_ROUNDS) {
        return { passed: false, files: currentFiles, output: result.output };
      }
      const fixed = await CodegenPlaywrightValidator.requestFix(currentFiles, result.output, llm);
      if (!fixed?.length) return { passed: false, files: currentFiles, output: result.output };
      currentFiles = fixed;
    }
    return { passed: false, files: currentFiles, output: '' };
  }

  private static async requestFix(
    files: GeneratedFile[],
    playwrightOutput: string,
    llm: LLMClient
  ): Promise<GeneratedFile[] | null> {
    const systemPrompt = PromptLoader.loadWithVars('codegen-fix/playwright-system.md', {
      guidelines: CodegenContext.loadGuidelines(),
    });
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Pytest Playwright failure:\n${playwrightOutput}\n\nFiles:\n${files.map((file) => `--- ${file.path} ---\n${file.content}`).join('\n\n')}`,
      },
    ];
    try {
      const response = await llm.complete(messages);
      const cleaned = response.text.trim().replace(/^```json\s*/, '').replace(/```$/, '');
      return (JSON.parse(cleaned) as { files: GeneratedFile[] }).files ?? null;
    } catch (error) {
      console.error('[CodegenPlaywrightValidator] Auto-fix parse failed:', error);
      return null;
    }
  }
}
