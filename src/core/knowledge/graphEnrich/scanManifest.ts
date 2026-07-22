import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  KNOWLEDGE_INTERMEDIATE_ROOT,
  KNOWLEDGE_SCAN_MANIFEST_PATH,
  PROJECT_ROOT,
} from '../../ProjectPaths';
import type { KnowledgeNode, RepoKnowledgeGraphData } from '../RepoKnowledgeGraph';
import type { ScanManifest, ScanTarget } from './types';

const SNIPPET_CHARS = 1800;
const FOCUS = 'packages/test-framework';

function isTestFrameworkPath(filePath?: string): boolean {
  if (!filePath) return false;
  const n = filePath.replace(/\\/g, '/');
  return n.includes('test-framework/') || n.includes('/pages/') || n.startsWith('pages/');
}

function readSnippet(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);
  if (!fs.existsSync(abs)) return undefined;
  try {
    const raw = fs.readFileSync(abs, 'utf8');
    return raw.length > SNIPPET_CHARS ? `${raw.slice(0, SNIPPET_CHARS)}\n/* truncated */` : raw;
  } catch {
    return undefined;
  }
}

export function contentHashFor(filePath: string | undefined, extra = ''): string | undefined {
  const snippet = readSnippet(filePath);
  if (!snippet && !extra) return undefined;
  return crypto
    .createHash('sha1')
    .update(`${filePath || ''}\n${extra}\n${snippet || ''}`)
    .digest('hex')
    .slice(0, 12);
}

export function ensureIntermediateDir(): string {
  fs.mkdirSync(KNOWLEDGE_INTERMEDIATE_ROOT, { recursive: true });
  return KNOWLEDGE_INTERMEDIATE_ROOT;
}

/**
 * Deterministic scan step: project AST graph → test-framework-focused manifest.
 * Analogous to UA's scan-manifest.json (but for codegen/POM, not wiki).
 */
export function buildScanManifest(
  graph: RepoKnowledgeGraphData,
  options?: { maxPages?: number }
): ScanManifest {
  const maxPages = options?.maxPages ?? 40;
  const pages = graph.nodes
    .filter((n) => n.type === 'page' || (n.type === 'class' && /Page$/i.test(n.name)))
    .filter((n) => isTestFrameworkPath(n.filePath))
    .sort((a, b) => (a.filePath || '').localeCompare(b.filePath || '') || a.name.localeCompare(b.name))
    .slice(0, maxPages);

  const pageIds = new Set(pages.map((p) => p.id));
  const methods: KnowledgeNode[] = [];
  const methodByPage = new Map<string, string[]>();

  for (const page of pages) {
    const kids = graph.edges
      .filter((e) => e.from === page.id && e.type === 'contains')
      .map((e) => graph.nodes.find((n) => n.id === e.to))
      .filter((n): n is KnowledgeNode => !!n && n.type === 'method')
      .slice(0, 16);
    methodByPage.set(
      page.id,
      kids.map((k) => k.id)
    );
    methods.push(...kids);
  }

  const tests = graph.nodes
    .filter((n) => n.type === 'test' && isTestFrameworkPath(n.filePath))
    .slice(0, 40);

  const structuralNodes = [...pages, ...methods, ...tests].map((n) => ({
    id: n.id,
    type: n.type,
    name: n.name,
    filePath: n.filePath,
    signature: (n.meta?.signature as string) || undefined,
    contentHash: contentHashFor(n.filePath, n.name),
  }));

  const edges = graph.edges
    .filter((e) => pageIds.has(e.from) || pageIds.has(e.to) || methods.some((m) => m.id === e.from || m.id === e.to))
    .filter((e) => ['contains', 'extends', 'imports', 'references'].includes(e.type))
    .map((e) => ({ source: e.from, target: e.to, type: e.type }));

  const targets: ScanTarget[] = [];
  for (const page of pages) {
    const hash = contentHashFor(page.filePath, page.name);
    const already =
      page.meta?.enrichedBy === 'webpilot-llm' &&
      page.meta?.contentHash &&
      page.meta.contentHash === hash &&
      typeof page.meta?.summary === 'string';
    if (already) continue;

    targets.push({
      id: page.id,
      name: page.name,
      type: page.type,
      filePath: page.filePath,
      contentHash: hash,
      methodIds: methodByPage.get(page.id) || [],
    });

    for (const mid of methodByPage.get(page.id) || []) {
      const method = methods.find((m) => m.id === mid);
      if (!method) continue;
      const mHash = contentHashFor(method.filePath || page.filePath, method.name);
      const mAlready =
        method.meta?.enrichedBy === 'webpilot-llm' &&
        method.meta?.contentHash === mHash &&
        typeof method.meta?.summary === 'string';
      if (mAlready) continue;
      targets.push({
        id: method.id,
        name: method.name,
        type: 'method',
        filePath: method.filePath || page.filePath,
        signature: (method.meta?.signature as string) || method.name,
        contentHash: mHash,
        parentId: page.id,
      });
    }
  }

  return {
    version: '1.0.0',
    kind: 'codegen',
    generatedAt: new Date().toISOString(),
    root: graph.root || PROJECT_ROOT,
    focus: FOCUS,
    nodes: structuralNodes,
    edges,
    targets,
    stats: {
      pages: pages.length,
      methods: methods.length,
      tests: tests.length,
      targets: targets.length,
    },
  };
}

export function writeScanManifest(manifest: ScanManifest, outPath = KNOWLEDGE_SCAN_MANIFEST_PATH): string {
  ensureIntermediateDir();
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
  return outPath;
}

export function loadScanManifest(inputPath = KNOWLEDGE_SCAN_MANIFEST_PATH): ScanManifest | null {
  if (!fs.existsSync(inputPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(inputPath, 'utf8')) as ScanManifest;
  } catch {
    return null;
  }
}

export function clearAnalysisBatches(intermediateDir = KNOWLEDGE_INTERMEDIATE_ROOT): void {
  if (!fs.existsSync(intermediateDir)) return;
  for (const name of fs.readdirSync(intermediateDir)) {
    if (/^analysis-batch-\d+\.json$/i.test(name)) {
      fs.unlinkSync(path.join(intermediateDir, name));
    }
  }
}

export { readSnippet, isTestFrameworkPath };
