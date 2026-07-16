import * as fs from 'fs';
import * as path from 'path';
import {
  CODEGEN_HISTORY_DIR,
  CODEGEN_PLANS_DIR,
  CODEGEN_ROOT,
  CODEGEN_TRACES_DIR,
} from '../ProjectPaths';

export const CODEGEN_LATEST_POINTER = path.join(CODEGEN_ROOT, 'latest.json');
export const CODEGEN_AUDIT_DIR = path.join(CODEGEN_ROOT, 'audit');

export function ensureCodegenDirs(): void {
  for (const dir of [
    CODEGEN_ROOT,
    CODEGEN_TRACES_DIR,
    CODEGEN_PLANS_DIR,
    CODEGEN_HISTORY_DIR,
    CODEGEN_AUDIT_DIR,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function auditPath(slug: string): string {
  return path.join(CODEGEN_AUDIT_DIR, `${slug}.json`);
}

export function tracePath(slug: string): string {
  return path.join(CODEGEN_TRACES_DIR, `${slug}.json`);
}

export function planPath(slug: string): string {
  return path.join(CODEGEN_PLANS_DIR, `${slug}.json`);
}

export function codegenMetadataPath(slug: string): string {
  return path.join(CODEGEN_HISTORY_DIR, `${slug}.json`);
}

export function writeLatestPointer(slug: string, traceFile: string, planFile: string): void {
  ensureCodegenDirs();
  fs.writeFileSync(
    CODEGEN_LATEST_POINTER,
    JSON.stringify(
      {
        slug,
        tracePath: traceFile,
        planPath: planFile,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf8'
  );
}

export function readLatestPointer(): { slug: string; tracePath: string; planPath: string } | null {
  if (!fs.existsSync(CODEGEN_LATEST_POINTER)) return null;
  try {
    return JSON.parse(fs.readFileSync(CODEGEN_LATEST_POINTER, 'utf8'));
  } catch {
    return null;
  }
}
