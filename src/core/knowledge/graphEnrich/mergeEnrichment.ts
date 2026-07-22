import * as fs from 'fs';
import * as path from 'path';
import {
  KNOWLEDGE_INTERMEDIATE_ROOT,
  KNOWLEDGE_MERGE_REPORT_PATH,
} from '../../ProjectPaths';
import type { KnowledgeEdge, KnowledgeNode, RepoKnowledgeGraphData } from '../RepoKnowledgeGraph';
import type {
  AnalysisBatch,
  AnalysisEnrichEdge,
  AnalysisEnrichNode,
  MergeReport,
  ScanManifest,
} from './types';
import {
  EDGE_TYPE_ALIASES,
  NODE_TYPE_ALIASES,
  VALID_ENRICH_EDGE_TYPES,
  VALID_ENRICH_NODE_TYPES,
} from './types';

function normalizeNodeType(t: string | undefined): string {
  const raw = String(t || 'unknown').toLowerCase().trim();
  return NODE_TYPE_ALIASES[raw] || raw;
}

function normalizeEdgeType(t: string | undefined): string {
  const raw = String(t || 'related').toLowerCase().trim();
  const mapped = EDGE_TYPE_ALIASES[raw] || raw;
  return VALID_ENRICH_EDGE_TYPES.has(mapped) ? mapped : 'related';
}

export function listAnalysisBatchFiles(dir = KNOWLEDGE_INTERMEDIATE_ROOT): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => /^analysis-batch-\d+\.json$/i.test(n))
    .sort()
    .map((n) => path.join(dir, n));
}

export function loadAnalysisBatches(dir = KNOWLEDGE_INTERMEDIATE_ROOT): AnalysisBatch[] {
  const batches: AnalysisBatch[] = [];
  for (const file of listAnalysisBatchFiles(dir)) {
    try {
      batches.push(JSON.parse(fs.readFileSync(file, 'utf8')) as AnalysisBatch);
    } catch {
      // skip corrupt batch
    }
  }
  return batches;
}

export function writeAnalysisBatch(
  batch: AnalysisBatch,
  dir = KNOWLEDGE_INTERMEDIATE_ROOT
): string {
  fs.mkdirSync(dir, { recursive: true });
  const name = `analysis-batch-${String(batch.batchIndex).padStart(3, '0')}.json`;
  const out = path.join(dir, name);
  fs.writeFileSync(out, JSON.stringify(batch, null, 2), 'utf8');
  return out;
}

/**
 * Merge LLM analysis batches onto the AST graph.
 * Inspired by UA merge-knowledge-graph.py: normalize types, dedupe edges,
 * remap related targets by name, drop dangling edges, write a merge report.
 */
export function mergeEnrichmentBatches(
  graph: RepoKnowledgeGraphData,
  manifest: ScanManifest,
  batches: AnalysisBatch[]
): { graph: RepoKnowledgeGraphData; report: MergeReport } {
  const byId = new Map(
    graph.nodes.map((n) => [n.id, { ...n, meta: { ...(n.meta || {}) } } as KnowledgeNode])
  );
  const nameIndex = new Map<string, string>();
  for (const n of byId.values()) {
    nameIndex.set(n.name.toLowerCase(), n.id);
    if (n.filePath) nameIndex.set(n.filePath.replace(/\\/g, '/').toLowerCase(), n.id);
  }

  const hashByTarget = new Map(
    manifest.targets.map((t) => [t.id, t.contentHash] as const)
  );

  let appliedNodes = 0;
  let appliedEdges = 0;
  let droppedEdges = 0;
  let remappedRelated = 0;
  let skippedUnknownTypes = 0;
  const pendingEdges: AnalysisEnrichEdge[] = [];

  for (const batch of batches) {
    for (const raw of batch.nodes || []) {
      const nodeType = normalizeNodeType(raw.type || byId.get(raw.id || '')?.type);
      if (raw.type && !VALID_ENRICH_NODE_TYPES.has(nodeType) && !byId.has(raw.id || '')) {
        skippedUnknownTypes++;
        continue;
      }
      const id = raw.id;
      if (!id || !byId.has(id)) continue;

      const node = byId.get(id)!;
      const summary = typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 400) : '';
      const tags = Array.isArray(raw.intentTags)
        ? raw.intentTags.map((t) => String(t).slice(0, 48)).slice(0, 8)
        : [];
      if (!summary && !tags.length && !raw.urlHint && !raw.domain && !raw.layer) continue;

      if (summary) node.meta!.summary = summary;
      if (tags.length) node.meta!.intentTags = tags;
      if (raw.urlHint && !node.meta!.urlPattern) {
        node.meta!.urlPattern = String(raw.urlHint).slice(0, 120);
      }
      if (raw.layer) node.layer = String(raw.layer).slice(0, 64);
      if (raw.domain) node.meta!.domain = String(raw.domain).slice(0, 64);
      node.meta!.enrichedBy = 'webpilot-llm';
      node.meta!.enrichedAt = batch.analyzedAt || new Date().toISOString();
      const hash = hashByTarget.get(id);
      if (hash) node.meta!.contentHash = hash;
      byId.set(id, node);
      appliedNodes++;

      for (const related of raw.relatedTo || []) {
        pendingEdges.push({
          source: id,
          target: String(related),
          type: 'semantic',
          weight: 0.6,
        });
      }
    }

    for (const edge of batch.edges || []) {
      pendingEdges.push(edge);
    }
  }

  const edges: KnowledgeEdge[] = [...graph.edges];
  const seen = new Set(edges.map((e) => `${e.from}|${e.to}|${e.type}`));
  let dedupedEdges = 0;

  for (const edge of pendingEdges) {
    const edgeType = normalizeEdgeType(edge.type);
    let src = edge.source;
    let tgt = edge.target;
    if (!byId.has(src)) {
      const remapped = nameIndex.get(String(src).toLowerCase());
      if (remapped) {
        src = remapped;
        remappedRelated++;
      }
    }
    if (!byId.has(tgt)) {
      const remapped = nameIndex.get(String(tgt).toLowerCase());
      if (remapped) {
        tgt = remapped;
        remappedRelated++;
      }
    }
    if (!byId.has(src) || !byId.has(tgt) || src === tgt) {
      droppedEdges++;
      continue;
    }
    const key = `${src}|${tgt}|${edgeType === 'semantic' ? 'semantic' : edgeType}`;
    if (seen.has(key)) {
      dedupedEdges++;
      continue;
    }
    seen.add(key);
    edges.push({
      from: src,
      to: tgt,
      type: edgeType === 'related' || edgeType === 'semantic' ? 'semantic' : (edgeType as KnowledgeEdge['type']),
      meta: { source: 'webpilot-llm', weight: edge.weight ?? 0.5 },
    });
    appliedEdges++;
  }

  const nodes = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = edges.sort((a, b) =>
    `${a.from}:${a.to}:${a.type}`.localeCompare(`${b.from}:${b.to}:${b.type}`)
  );

  const tfPages = nodes.filter(
    (n) =>
      n.type === 'page' &&
      (n.filePath || '').replace(/\\/g, '/').includes('test-framework')
  );
  const tfMethods = nodes.filter((n) => {
    if (n.type !== 'method') return false;
    const parent = sortedEdges.find((e) => e.to === n.id && e.type === 'contains');
    const page = parent ? byId.get(parent.from) : undefined;
    return (page?.filePath || n.filePath || '').replace(/\\/g, '/').includes('test-framework');
  });

  const report: MergeReport = {
    generatedAt: new Date().toISOString(),
    baseNodes: manifest.nodes.length,
    batches: batches.length,
    appliedNodes,
    appliedEdges,
    dedupedEdges,
    droppedEdges,
    remappedRelated,
    skippedUnknownTypes,
    enrichedCoverage: {
      pagesWithSummary: tfPages.filter((n) => n.meta?.summary).length,
      pagesTotal: tfPages.length,
      methodsWithSummary: tfMethods.filter((n) => n.meta?.summary).length,
      methodsTotal: tfMethods.length,
    },
  };

  const enrichedCount = nodes.filter(
    (n) => n.meta?.enrichedBy === 'webpilot-llm' || n.meta?.summary
  ).length;

  return {
    graph: {
      ...graph,
      generatedAt: new Date().toISOString(),
      sources: {
        ...graph.sources,
        llmEnrich: appliedNodes > 0,
      },
      stats: {
        ...graph.stats,
        enriched: Math.max(graph.stats.enriched, enrichedCount),
        edges: sortedEdges.length,
      },
      notes: [
        ...graph.notes.filter((n) => !n.startsWith('LLM enrich:') && !n.startsWith('Graph enrich merge:')),
        `Graph enrich merge: ${appliedNodes} nodes, ${appliedEdges} edges from ${batches.length} batch(es)` +
          ` (deduped ${dedupedEdges}, dropped ${droppedEdges}).` +
          ` Coverage pages ${report.enrichedCoverage.pagesWithSummary}/${report.enrichedCoverage.pagesTotal}` +
          `, methods ${report.enrichedCoverage.methodsWithSummary}/${report.enrichedCoverage.methodsTotal}.`,
      ],
      nodes,
      edges: sortedEdges,
    },
    report,
  };
}

export function writeMergeReport(report: MergeReport, outPath = KNOWLEDGE_MERGE_REPORT_PATH): string {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  return outPath;
}

/** Pure merge helper for tests — accepts in-memory batches. */
export function mergeAnalysisNodes(
  graph: RepoKnowledgeGraphData,
  nodes: AnalysisEnrichNode[],
  edges: AnalysisEnrichEdge[] = []
): { graph: RepoKnowledgeGraphData; report: MergeReport } {
  const manifest: ScanManifest = {
    version: '1.0.0',
    kind: 'codegen',
    generatedAt: new Date().toISOString(),
    root: graph.root,
    focus: 'packages/test-framework',
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      filePath: n.filePath,
    })),
    edges: [],
    targets: nodes.map((n) => ({
      id: n.id!,
      name: n.name || n.id!,
      type: n.type || 'page',
    })),
    stats: { pages: 0, methods: 0, tests: 0, targets: nodes.length },
  };
  const batch: AnalysisBatch = {
    version: '1.0.0',
    batchIndex: 1,
    analyzedAt: new Date().toISOString(),
    targetIds: nodes.map((n) => n.id!).filter(Boolean),
    nodes,
    edges,
  };
  return mergeEnrichmentBatches(graph, manifest, [batch]);
}
