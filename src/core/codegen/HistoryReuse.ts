import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { resolveExecutionHistoryPath } from '../ReportPaths';

export interface HistoryReuseDecision {
  reuse: boolean;
  reason: string;
  historyPath?: string;
  fingerprint?: string;
}

function fingerprintDocument(doc: Record<string, unknown>): string {
  const act = doc.actHistory ?? doc.executionHistory ?? doc.steps ?? [];
  const payload = JSON.stringify({
    act,
    urls: doc.urlSequence ?? [],
    ok: doc.isSuccessful ?? doc.isDone ?? null,
  });
  return crypto.createHash('sha1').update(payload).digest('hex').slice(0, 16);
}

/**
 * When re-running the same NL scenario with --codegen, skip expensive browser-use
 * rediscovery if a successful ActHistory already exists and the test file is unchanged.
 *
 * Override: WEBPILOT_FORCE_DISCOVERY=1 (also set by --force-discovery)
 * Disable:  WEBPILOT_REUSE_HISTORY=0
 */
export function decideHistoryReuse(testFilePath: string, slug: string): HistoryReuseDecision {
  if (process.env.WEBPILOT_FORCE_DISCOVERY === '1') {
    return { reuse: false, reason: 'WEBPILOT_FORCE_DISCOVERY=1' };
  }
  if (process.env.WEBPILOT_REUSE_HISTORY === '0') {
    return { reuse: false, reason: 'WEBPILOT_REUSE_HISTORY=0' };
  }
  // Auto-enable for codegen runs; allow explicit opt-in otherwise.
  if (process.env.WEBPILOT_CODEGEN !== '1' && process.env.WEBPILOT_REUSE_HISTORY !== '1') {
    return {
      reuse: false,
      reason: 'history reuse auto-enabled only with --codegen (set WEBPILOT_REUSE_HISTORY=1 to always)',
    };
  }

  const historyPath = resolveExecutionHistoryPath(slug);
  if (!fs.existsSync(historyPath)) {
    return { reuse: false, reason: 'no prior execution history on disk' };
  }
  if (!fs.existsSync(testFilePath)) {
    return { reuse: false, reason: 'test file missing' };
  }

  const testMtime = fs.statSync(testFilePath).mtimeMs;
  const histMtime = fs.statSync(historyPath).mtimeMs;
  if (testMtime > histMtime + 1000) {
    return {
      reuse: false,
      reason: 'test file is newer than prior ActHistory — rediscovering',
      historyPath,
    };
  }

  try {
    const doc = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as Record<string, unknown>;
    const steps = (doc.actHistory ?? doc.executionHistory ?? []) as unknown[];
    if (!Array.isArray(steps) || steps.length === 0) {
      return { reuse: false, reason: 'prior history has no steps', historyPath };
    }
    const ok = doc.isSuccessful === true || doc.isDone === true;
    if (!ok && doc.isSuccessful !== undefined) {
      return { reuse: false, reason: 'prior discovery was not successful', historyPath };
    }
    return {
      reuse: true,
      reason: `reusing ${steps.length} ActHistory step(s) from ${path.relative(process.cwd(), historyPath)}`,
      historyPath,
      fingerprint: fingerprintDocument(doc),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { reuse: false, reason: `prior history unreadable: ${message}`, historyPath };
  }
}

export function fingerprintHistoryFile(historyPath: string): string | null {
  if (!fs.existsSync(historyPath)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as Record<string, unknown>;
    return fingerprintDocument(doc);
  } catch {
    return null;
  }
}
