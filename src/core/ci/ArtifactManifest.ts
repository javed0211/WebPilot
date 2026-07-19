import * as fs from 'fs';
import * as path from 'path';
import {
  ensureReportDirs,
  listSummarySlugs,
  REPORTS_DATA_DIR,
  REPORTS_HTML_DIR,
  REPORTS_JUNIT_DIR,
  REPORTS_SCREENSHOTS_DIR,
  REPORTS_TRACES_DIR,
  REPORTS_VIDEOS_DIR,
  resolveSummaryPath,
  suiteIndexHtmlPath,
  testReportHtmlPath,
} from '../ReportPaths';
import { REPORTS_ROOT } from '../ProjectPaths';
import { REPORTS_EVIDENCE_DIR } from '../events/EventPaths';

export interface ArtifactManifest {
  version: '1.0.0';
  generatedAt: string;
  root: string;
  htmlReports: string[];
  junit: string[];
  traces: string[];
  videos: string[];
  screenshots: string[];
  summaries: string[];
  evidence: string[];
  data: string[];
}

export const ARTIFACT_MANIFEST_PATH = path.join(REPORTS_ROOT, 'artifact-manifest.json');

function relativeIfExists(filePath: string): string[] {
  return fs.existsSync(filePath) ? [path.relative(process.cwd(), filePath)] : [];
}

function collectFiles(dir: string, predicate: (fileName: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (predicate(entry.name)) {
        out.push(path.relative(process.cwd(), full));
      }
    }
  };
  walk(dir);
  return out.sort();
}

export function buildArtifactManifest(): ArtifactManifest {
  ensureReportDirs();
  const slugs = listSummarySlugs();
  const htmlReports = [
    ...relativeIfExists(suiteIndexHtmlPath()),
    ...slugs.flatMap((slug) => relativeIfExists(testReportHtmlPath(slug))),
  ];

  return {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    root: path.relative(process.cwd(), REPORTS_ROOT) || '.',
    htmlReports,
    junit: collectFiles(REPORTS_JUNIT_DIR, (file) => file.endsWith('.xml')),
    traces: collectFiles(REPORTS_TRACES_DIR, (file) => file.endsWith('.zip')),
    videos: collectFiles(REPORTS_VIDEOS_DIR, (file) => /\.(webm|mp4)$/i.test(file)),
    screenshots: collectFiles(REPORTS_SCREENSHOTS_DIR, (file) => /\.(png|jpe?g|webp)$/i.test(file)),
    summaries: slugs.map((slug) => path.relative(process.cwd(), resolveSummaryPath(slug))).sort(),
    evidence: collectFiles(REPORTS_EVIDENCE_DIR, (file) => file.endsWith('_evidence.json')),
    data: collectFiles(REPORTS_DATA_DIR, (file) => /\.(json|xml|txt)$/i.test(file)),
  };
}

export function writeArtifactManifest(
  outputPath = ARTIFACT_MANIFEST_PATH
): { path: string; manifest: ArtifactManifest } {
  const manifest = buildArtifactManifest();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { path: outputPath, manifest };
}
