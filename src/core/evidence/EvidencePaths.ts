import * as fs from 'fs';
import * as path from 'path';
import { REPORTS_ROOT } from '../ProjectPaths';
import { REPORTS_EVIDENCE_DIR } from '../events/EventPaths';

export { REPORTS_EVIDENCE_DIR };

export function ensureEvidenceDirs(): void {
  fs.mkdirSync(REPORTS_EVIDENCE_DIR, { recursive: true });
}

export function evidenceDir(slug: string): string {
  return path.join(REPORTS_EVIDENCE_DIR, slug);
}

export function evidenceBundlePath(slug: string, runId: string): string {
  return path.join(evidenceDir(slug), `${runId}_evidence.json`);
}

export function evidenceStepTimelinePath(slug: string, runId: string): string {
  return path.join(evidenceDir(slug), `${runId}_step-timeline.json`);
}

/** Path relative to reports root (for manifests / HTML hrefs). */
export function evidenceBundleHref(slug: string, runId: string): string {
  const abs = evidenceBundlePath(slug, runId);
  return path.relative(REPORTS_ROOT, abs).replace(/\\/g, '/');
}

/** Project-relative path for summary evidenceRef. */
export function evidenceBundleRel(slug: string, runId: string): string {
  const abs = evidenceBundlePath(slug, runId);
  return path.relative(process.cwd(), abs).replace(/\\/g, '/');
}
