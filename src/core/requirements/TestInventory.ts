import * as fs from 'fs';
import * as path from 'path';
import { TESTS_API_ROOT, TESTS_WEB_ROOT, PROJECT_ROOT } from '../ProjectPaths';
import { resolveSummaryPath } from '../ReportPaths';
import { loadRunHistory } from '../execution_report/history';
import { ScenarioMetadataParser } from '../authoring/ScenarioMetadata';

export interface TestStep {
  index: number;
  text: string;
}

export interface TestArtifact {
  /** Repo-relative path. */
  path: string;
  /** Execution-history slug (filename stem for natural-language tests). */
  slug: string;
  kind: 'web' | 'api';
  title: string;
  tags: string[];
  steps: TestStep[];
  /** Lowercased searchable blob (title + steps). */
  blob: string;
  lastStatus?: string;
  /** 0..1 flake score derived from run history (higher = flakier). */
  flakeScore: number;
  /** Feature 11 governance signals from latest summary/evidence. */
  governance?: {
    riskScore?: number;
    riskLevel?: string;
    completenessScore?: number;
    completenessGrade?: string;
    healingCount?: number;
    verifiedLocatorRatio?: number;
    codegenQuality?: string | null;
    evidenceRef?: string;
    riskFactors?: string[];
  };
}

const STEP_RE = /^\s*(?:\d+[.)]|[-*•])\s+(.*)$/;

function relPath(abs: string): string {
  return path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
}

function walkTxt(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTxt(full));
    else if (entry.isFile() && entry.name.endsWith('.txt')) out.push(full);
  }
  return out;
}

function parseSteps(content: string): TestStep[] {
  const steps: TestStep[] = [];
  let index = 0;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('@')) continue;
    const match = line.match(STEP_RE);
    if (match && match[1].trim()) {
      index += 1;
      steps.push({ index, text: match[1].trim() });
      continue;
    }
    // BDD-style steps without numbering.
    if (/^(given|when|then|and|but)\b/i.test(line)) {
      index += 1;
      steps.push({ index, text: line });
      continue;
    }
    // API NL verbs (OpenAPI suites).
    if (/^(send|assert|with|extract)\b/i.test(line)) {
      index += 1;
      steps.push({ index, text: line });
    }
  }
  return steps;
}

/**
 * Computes a flake score from a test's run history. Counts pass/fail
 * transitions across recent runs (a stable test trends to 0, an alternating
 * test trends to 1) and biases up when the most recent run failed.
 */
function flakeScoreForSlug(slug: string): { score: number; lastStatus?: string } {
  const history = loadRunHistory(slug); // newest first
  const summaryPath = resolveSummaryPath(slug);
  let lastStatus: string | undefined;

  const statuses: string[] = history.map((run) => String(run.status || '').toUpperCase());
  if (statuses.length === 0 && fs.existsSync(summaryPath)) {
    try {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as { status?: string };
      if (summary.status) statuses.push(String(summary.status).toUpperCase());
    } catch {
      /* ignore */
    }
  }
  lastStatus = statuses[0];

  if (statuses.length < 2) {
    return { score: lastStatus && lastStatus !== 'PASSED' ? 0.5 : 0, lastStatus };
  }

  const recent = statuses.slice(0, 10);
  let transitions = 0;
  for (let i = 1; i < recent.length; i += 1) {
    const a = recent[i - 1] === 'PASSED';
    const b = recent[i] === 'PASSED';
    if (a !== b) transitions += 1;
  }
  const transitionScore = transitions / (recent.length - 1);
  const recentFailBias = lastStatus && lastStatus !== 'PASSED' ? 0.15 : 0;
  return { score: Math.min(1, Number((transitionScore + recentFailBias).toFixed(2))), lastStatus };
}

function governanceForSlug(slug: string): TestArtifact['governance'] {
  const summaryPath = resolveSummaryPath(slug);
  if (!fs.existsSync(summaryPath)) return undefined;
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as {
      risk?: { score?: number; level?: string; factors?: Array<{ id?: string }> };
      completeness?: { score?: number; grade?: string };
      evidenceRef?: string;
      evidence?: {
        healingCount?: number;
        verifiedLocatorRatio?: number;
        codegenQuality?: string | null;
      };
    };
    if (!summary.risk && !summary.completeness && !summary.evidenceRef && !summary.evidence) {
      return undefined;
    }
    return {
      riskScore: summary.risk?.score,
      riskLevel: summary.risk?.level,
      completenessScore: summary.completeness?.score,
      completenessGrade: summary.completeness?.grade,
      healingCount: summary.evidence?.healingCount,
      verifiedLocatorRatio: summary.evidence?.verifiedLocatorRatio,
      codegenQuality: summary.evidence?.codegenQuality,
      evidenceRef: summary.evidenceRef,
      riskFactors: (summary.risk?.factors || [])
        .map((f) => f.id)
        .filter((id): id is string => Boolean(id)),
    };
  } catch {
    return undefined;
  }
}

export class TestInventory {
  public static collect(): TestArtifact[] {
    const files = [
      ...walkTxt(TESTS_WEB_ROOT).map((f) => ({ f, kind: 'web' as const })),
      ...walkTxt(TESTS_API_ROOT).map((f) => ({ f, kind: 'api' as const })),
    ];

    const artifacts: TestArtifact[] = [];
    for (const { f, kind } of files) {
      let content = '';
      try {
        content = fs.readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      const meta = ScenarioMetadataParser.parse(content);
      const steps = parseSteps(content);
      const slug = path.basename(f, '.txt');
      const title = meta.name || slug.replace(/[_-]+/g, ' ');
      const blob = [title, ...steps.map((s) => s.text), ...meta.tags].join(' \n ').toLowerCase();
      const flake = flakeScoreForSlug(slug);

      artifacts.push({
        path: relPath(f),
        slug,
        kind,
        title,
        tags: meta.tags,
        steps,
        blob,
        lastStatus: flake.lastStatus,
        flakeScore: flake.score,
        governance: governanceForSlug(slug),
      });
    }
    return artifacts;
  }
}
