import * as fs from 'fs';
import * as path from 'path';
import { REPORTS_VIDEOS_DIR, resolveSummaryPath } from './ReportPaths';

export type PhaseState =
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'not-requested'
  | 'from-discovery'
  | 'from-codegen';

export interface RunPhases {
  /** browser-use / agent discovery */
  discovery: PhaseState;
  /** deterministic / LLM file generation */
  codegen: PhaseState;
  /** Playwright run of the generated .spec.ts */
  specRerun: PhaseState;
  /** Report .webm attachment */
  evidenceVideo: PhaseState;
  reasons?: Partial<Record<keyof Omit<RunPhases, 'reasons'>, string>>;
}

export function emptyPhases(partial?: Partial<RunPhases>): RunPhases {
  return {
    discovery: 'not-requested',
    codegen: 'not-requested',
    specRerun: 'not-requested',
    evidenceVideo: 'not-requested',
    reasons: {},
    ...partial,
  };
}

/** Overall pass requires discovery (+ codegen/spec when those were requested). Video is informational. */
export function overallSuccess(phases: RunPhases): boolean {
  if (phases.discovery === 'failed') return false;
  if (phases.discovery !== 'passed' && phases.discovery !== 'skipped') return false;
  if (phases.codegen === 'failed' || phases.specRerun === 'failed') return false;
  return true;
}

export function formatPhases(phases: RunPhases): string[] {
  const label = (state: PhaseState) => {
    switch (state) {
      case 'passed':
      case 'from-discovery':
      case 'from-codegen':
        return 'PASSED';
      case 'failed':
        return 'FAILED';
      case 'skipped':
        return 'SKIPPED';
      default:
        return 'N/A';
    }
  };
  const lines = [
    `Discovery: ${label(phases.discovery)}`,
    `Codegen: ${label(phases.codegen)}`,
    `Spec rerun: ${label(phases.specRerun)}`,
    `Evidence video: ${label(phases.evidenceVideo)}`,
  ];
  const reasons = phases.reasons || {};
  for (const [key, reason] of Object.entries(reasons)) {
    if (reason) lines.push(`  (${key}: ${reason})`);
  }
  return lines;
}

const MIN_VIDEO_BYTES = 2_000;

export function hasUsableReportVideo(slug: string): boolean {
  const summaryPath = resolveSummaryPath(slug);
  if (fs.existsSync(summaryPath)) {
    try {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as {
        artifacts?: { video?: string };
      };
      const video = summary.artifacts?.video;
      if (video && fs.existsSync(video) && fs.statSync(video).size >= MIN_VIDEO_BYTES) {
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  for (const ext of ['.webm', '.mp4']) {
    const candidate = path.join(REPORTS_VIDEOS_DIR, `${slug}${ext}`);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size >= MIN_VIDEO_BYTES) {
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * After codegen Playwright validation, copy the newest usable video under
 * test-results/ into runtime/reports/videos/{slug}.webm and patch the summary.
 * Only accepts videos newer than runStartedAt (avoids scavenging prior runs).
 */
export function harvestCodegenValidationVideo(
  slug: string,
  runStartedAt?: number
): string | undefined {
  const roots = [
    path.join(process.cwd(), 'test-results'),
    path.join(process.cwd(), 'packages', 'test-framework', 'test-results'),
  ];
  const candidates: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    collectVideos(root, candidates);
  }
  const minMtime = typeof runStartedAt === 'number' ? runStartedAt - 5_000 : 0;
  candidates.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
  const src = candidates.find((p) => {
    try {
      const st = fs.statSync(p);
      return st.size >= MIN_VIDEO_BYTES && st.mtimeMs >= minMtime;
    } catch {
      return false;
    }
  });
  if (!src) return undefined;

  const ext = path.extname(src) || '.webm';
  fs.mkdirSync(REPORTS_VIDEOS_DIR, { recursive: true });
  const dest = path.join(REPORTS_VIDEOS_DIR, `${slug}${ext}`);
  try {
    fs.copyFileSync(src, dest);
  } catch {
    return undefined;
  }
  if (!fs.existsSync(dest) || fs.statSync(dest).size < MIN_VIDEO_BYTES) return undefined;

  const summaryPath = resolveSummaryPath(slug);
  if (fs.existsSync(summaryPath)) {
    try {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as Record<string, unknown>;
      const artifacts = { ...((summary.artifacts as Record<string, unknown>) || {}) };
      artifacts.video = dest;
      summary.artifacts = artifacts;
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
    } catch {
      /* best-effort */
    }
  }
  return dest;
}

/** true = fresh / unknown; false = clearly stale vs this run. */
export function isReportVideoFromThisRun(slug: string, runStartedAt?: number): boolean | undefined {
  if (typeof runStartedAt !== 'number') return undefined;
  const minMtime = runStartedAt - 5_000;
  for (const ext of ['.webm', '.mp4']) {
    const candidate = path.join(REPORTS_VIDEOS_DIR, `${slug}${ext}`);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).mtimeMs >= minMtime) return true;
    } catch {
      /* ignore */
    }
  }
  const summaryPath = resolveSummaryPath(slug);
  if (fs.existsSync(summaryPath)) {
    try {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as {
        artifacts?: { video?: string };
      };
      const video = summary.artifacts?.video;
      if (video && fs.existsSync(video) && fs.statSync(video).mtimeMs >= minMtime) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function collectVideos(dir: string, out: string[], depth = 0): void {
  if (depth > 6) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectVideos(full, out, depth + 1);
    } else if (/\.(webm|mp4)$/i.test(entry.name)) {
      out.push(full);
    }
  }
}
