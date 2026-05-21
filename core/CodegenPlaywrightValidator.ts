import { execSync } from 'child_process';
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

/**
 * Runs generated Playwright specs and optionally auto-fixes via LLM from failure output.
 */
export class CodegenPlaywrightValidator {
  public static runSpecs(relativeSpecPaths: string[]): PlaywrightRunResult {
    const existing = relativeSpecPaths.filter((p) =>
      fs.existsSync(path.join(process.cwd(), p))
    );
    if (existing.length === 0) {
      return { passed: true, output: 'No spec files to run.', specPaths: [] };
    }

    const args = existing
      .map((p) => path.join(process.cwd(), p))
      .join(' ');

    try {
      execSync(
        `npx playwright test ${args} -c framework/playwright.config.ts --retries=0`,
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 180_000,
          env: { ...process.env, FORCE_COLOR: '0' },
        }
      );
      return { passed: true, output: 'All specs passed.', specPaths: existing };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const output = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n');
      return { passed: false, output: output.slice(-12000), specPaths: existing };
    }
  }

  public static async validateAndFix(
    files: GeneratedFile[],
    llm: LLMClient
  ): Promise<{ passed: boolean; files: GeneratedFile[]; output: string }> {
    const specPaths = files.filter((f) => f.path.endsWith('.spec.ts')).map((f) => f.path);
    let currentFiles = [...files];

    for (let round = 0; round <= MAX_PLAYWRIGHT_FIX_ROUNDS; round++) {
      for (const file of currentFiles) {
        const fullPath = path.join(process.cwd(), file.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.content, 'utf8');
      }

      const result = CodegenPlaywrightValidator.runSpecs(specPaths);
      if (result.passed) {
        if (round > 0) {
          console.log('\x1b[32m[CodegenPlaywrightValidator] Generated specs pass Playwright.\x1b[0m');
        }
        return { passed: true, files: currentFiles, output: result.output };
      }

      console.warn(
        `\x1b[33m[CodegenPlaywrightValidator] Playwright run failed (round ${round + 1}).\x1b[0m`
      );

      if (round === MAX_PLAYWRIGHT_FIX_ROUNDS) {
        console.error(result.output.slice(-2000));
        return { passed: false, files: currentFiles, output: result.output };
      }

      console.log(`\x1b[34m[CodegenPlaywrightValidator] Attempting LLM fix from Playwright errors...\x1b[0m`);
      const fixed = await CodegenPlaywrightValidator.requestFix(currentFiles, result.output, llm);
      if (!fixed?.length) {
        return { passed: false, files: currentFiles, output: result.output };
      }
      currentFiles = fixed;
    }

    return { passed: false, files: currentFiles, output: '' };
  }

  private static async requestFix(
    files: GeneratedFile[],
    playwrightOutput: string,
    llm: LLMClient
  ): Promise<GeneratedFile[] | null> {
    const filesText = files.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');

    const systemPrompt = PromptLoader.loadWithVars('codegen-fix/playwright-system.md', {
      guidelines: CodegenContext.loadGuidelines(),
    });

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Playwright failure:\n${playwrightOutput}\n\nFiles:\n${filesText}`,
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
      console.error('[CodegenPlaywrightValidator] Auto-fix parse failed:', err);
      return null;
    }
  }
}
