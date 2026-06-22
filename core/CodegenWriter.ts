import * as fs from 'fs';
import * as path from 'path';
import { GeneratedFile } from '../agents/CodegenAgent';
import { CodegenValidator } from '../agents/CodegenValidator';
import { ASTMerger } from './SymbolParser';
import { LLMClient } from './LLMClient';
import { CodegenNormalizer, NormalizeOptions } from './CodegenNormalizer';
import { CodegenPlaywrightValidator } from './CodegenPlaywrightValidator';
import {
  AUTOMATION_EXERCISE_BASE_PAGE_PATH,
  loadCanonicalPageContent,
} from './CodegenCanonicalPages';

const MONOLITHIC_PAGE_DENYLIST = [
  'automation_exercise_page.py',
  'AutomationExercisePage.py',
];

export class CodegenWriter {
  public static ensureSiteScaffolds(files: GeneratedFile[]): void {
    if (!files.some((file) => file.path.includes('automationexercise'))) return;
    const fullPath = path.join(process.cwd(), AUTOMATION_EXERCISE_BASE_PAGE_PATH);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(
        fullPath,
        loadCanonicalPageContent()[AUTOMATION_EXERCISE_BASE_PAGE_PATH],
        'utf8'
      );
    }
  }

  private static isPageObjectPath(filePath: string): boolean {
    return filePath.startsWith('framework/pages/') && filePath.endsWith('.py');
  }

  public static writeFiles(files: GeneratedFile[]): string[] {
    const written: string[] = [];
    for (const file of files) {
      if (MONOLITHIC_PAGE_DENYLIST.includes(path.basename(file.path))) {
        console.error(`[CodegenWriter] Rejected monolithic page "${file.path}".`);
        continue;
      }
      const fullPath = path.join(process.cwd(), file.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      if (
        CodegenWriter.isPageObjectPath(file.path) &&
        fs.existsSync(fullPath) &&
        !CodegenNormalizer.isCanonicalPagePath(file.path)
      ) {
        fs.writeFileSync(
          fullPath,
          ASTMerger.mergeClassContent(fullPath, file.content),
          'utf8'
        );
      } else {
        fs.writeFileSync(fullPath, file.content, 'utf8');
      }
      written.push(file.path);
    }
    return written;
  }

  public static readFilesFromDisk(paths: string[]): GeneratedFile[] {
    return paths.map((filePath) => ({
      path: filePath,
      content: fs.readFileSync(path.join(process.cwd(), filePath), 'utf8'),
    }));
  }

  public static async writeAndValidate(
    files: GeneratedFile[],
    llm: LLMClient,
    normalizeOptions?: NormalizeOptions
  ): Promise<{ ok: boolean; paths: string[] }> {
    const normalized = CodegenNormalizer.normalize(files, normalizeOptions);
    CodegenWriter.ensureSiteScaffolds(normalized);
    const paths = CodegenWriter.writeFiles(normalized);
    if (paths.length === 0) return { ok: false, paths: [] };

    const onDisk = CodegenWriter.readFilesFromDisk(paths);
    console.log(`[CodegenValidator] Running Python syntax checks on ${paths.length} file(s)...`);
    const validation = await CodegenValidator.validateAndFix(onDisk, llm);
    if (!validation.valid) {
      validation.issues.forEach((issue) =>
        console.error(`${issue.file}:${issue.line} — ${issue.message}`)
      );
      return { ok: false, paths };
    }
    if (validation.files.some((file, index) => file.content !== onDisk[index]?.content)) {
      CodegenWriter.writeFiles(validation.files);
    }

    const finalFiles = CodegenWriter.readFilesFromDisk(paths);
    if (finalFiles.some((file) => /framework\/tests\/test_.+\.py$/.test(file.path))) {
      console.log('[CodegenPlaywrightValidator] Running generated pytest Playwright tests...');
      const result = await CodegenPlaywrightValidator.validateAndFix(finalFiles, llm);
      if (!result.passed) return { ok: false, paths };
      CodegenWriter.writeFiles(CodegenNormalizer.normalize(result.files, normalizeOptions));
    }
    return { ok: true, paths };
  }
}
