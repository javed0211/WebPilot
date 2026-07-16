import * as fs from 'fs';
import * as path from 'path';
import { CODEGEN_ROOT } from '../ProjectPaths';
import { ensureCodegenDirs } from './CodegenPaths';

export interface CodegenFailureRecord {
  slug: string;
  updatedAt: string;
  paths: string[];
  playwrightOutput?: string;
  tsIssues?: string[];
  referenceIssues?: string[];
  fixReport?: string;
  historyFingerprint?: string;
}

function failurePath(slug: string): string {
  return path.join(CODEGEN_ROOT, 'failures', `${slug}.json`);
}

export class CodegenFailureMemory {
  public static load(slug: string): CodegenFailureRecord | null {
    const file = failurePath(slug);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as CodegenFailureRecord;
    } catch {
      return null;
    }
  }

  public static save(record: CodegenFailureRecord): string {
    ensureCodegenDirs();
    const dir = path.join(CODEGEN_ROOT, 'failures');
    fs.mkdirSync(dir, { recursive: true });
    const file = failurePath(record.slug);
    fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf8');
    return file;
  }

  public static clear(slug: string): void {
    const file = failurePath(slug);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  /** Compact prompt block for CodegenAgent / fix agents. */
  public static toPromptBlock(slug: string): string {
    const record = CodegenFailureMemory.load(slug);
    if (!record) return '';
    const lines = [
      '=== PRIOR CODEGEN FAILURES (do not repeat these mistakes) ===',
      `Recorded: ${record.updatedAt}`,
      record.paths.length ? `Files: ${record.paths.join(', ')}` : '',
      record.tsIssues?.length ? `TypeScript:\n${record.tsIssues.slice(0, 12).join('\n')}` : '',
      record.referenceIssues?.length
        ? `References:\n${record.referenceIssues.slice(0, 8).join('\n')}`
        : '',
      record.playwrightOutput
        ? `Playwright (tail):\n${record.playwrightOutput.slice(-4000)}`
        : '',
      record.fixReport ? `Previous fixReport:\n${record.fixReport.slice(0, 1500)}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  }
}
