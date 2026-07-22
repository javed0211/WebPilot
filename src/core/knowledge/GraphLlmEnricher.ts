import { LLMClient, LLMMessage } from '../LLMClient';
import { Logger } from '../../utils/Logger';
import type { RepoKnowledgeGraphData } from './RepoKnowledgeGraph';
import {
  buildScanManifest,
  clearAnalysisBatches,
  readSnippet,
  writeScanManifest,
} from './graphEnrich/scanManifest';
import {
  loadAnalysisBatches,
  mergeEnrichmentBatches,
  writeAnalysisBatch,
  writeMergeReport,
} from './graphEnrich/mergeEnrichment';
import type { AnalysisBatch, AnalysisEnrichNode, ScanTarget } from './graphEnrich/types';
import { KNOWLEDGE_INTERMEDIATE_ROOT } from '../ProjectPaths';

export interface GraphEnrichOptions {
  /** Max page/class nodes to enrich per run (methods piggyback). */
  maxPages?: number;
  /** Max LLM batches. */
  maxBatches?: number;
  /** Targets per LLM batch (pages; methods included with their page). */
  batchSize?: number;
  llm?: LLMClient;
  /** Keep prior analysis-batch-*.json and merge them (default: clear then rewrite). */
  keepBatches?: boolean;
}

export interface GraphEnrichResult {
  graph: RepoKnowledgeGraphData;
  enrichedNodes: number;
  batches: number;
  skippedReason?: string;
  intermediateDir?: string;
  mergeReportPath?: string;
}

const DEFAULT_MAX_PAGES = 40;
const DEFAULT_MAX_BATCHES = 8;
const DEFAULT_BATCH_SIZE = 3;

function extractJson(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```$/m, '').trim();
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = cleaned.slice(start, end + 1);
    if (slice.includes('"nodes"') || slice.includes("'nodes'") || slice.includes('"id"')) {
      return slice;
    }
  }
  const arrStart = cleaned.indexOf('[');
  const arrEnd = cleaned.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) return cleaned.slice(arrStart, arrEnd + 1);
  return cleaned;
}

/** Recover truncated LLM JSON by harvesting complete {...} objects. */
function recoverPartialNodes(text: string): AnalysisEnrichNode[] {
  const nodes: AnalysisEnrichNode[] = [];
  const re = /\{[^{}]*"id"\s*:\s*"[^"]+"[^{}]*\}/g;
  const matches = text.match(re) || [];
  for (const m of matches) {
    try {
      const obj = JSON.parse(m) as AnalysisEnrichNode;
      if (obj?.id) nodes.push(obj);
    } catch {
      // skip
    }
  }
  return nodes;
}

function parseBatchResponse(text: string): {
  nodes: AnalysisEnrichNode[];
  edges: AnalysisBatch['edges'];
} {
  try {
    const parsed = JSON.parse(extractJson(text));
    if (Array.isArray(parsed)) {
      return { nodes: parsed as AnalysisEnrichNode[], edges: [] };
    }
    return {
      nodes: Array.isArray(parsed?.nodes)
        ? parsed.nodes
        : Array.isArray(parsed?.items)
          ? parsed.items
          : [],
      edges: Array.isArray(parsed?.edges) ? parsed.edges : [],
    };
  } catch {
    const recovered = recoverPartialNodes(text);
    if (recovered.length) {
      Logger.warn(`[GraphEnrich] Recovered ${recovered.length} node(s) from truncated JSON`);
      return { nodes: recovered, edges: [] };
    }
    throw new Error('Unexpected end of JSON input');
  }
}

function chunkPageGroups(targets: ScanTarget[], batchSize: number): ScanTarget[][] {
  const pages = targets.filter((t) => t.type === 'page' || t.type === 'class');
  const methods = targets.filter((t) => t.type === 'method');
  const groups: ScanTarget[][] = [];

  for (let i = 0; i < pages.length; i += batchSize) {
    const pageSlice = pages.slice(i, i + batchSize);
    const pageIds = new Set(pageSlice.map((p) => p.id));
    // Cap methods hard — large batches truncate LLM JSON
    const relatedMethods = methods
      .filter((m) => m.parentId && pageIds.has(m.parentId))
      .slice(0, batchSize * 4);
    groups.push([...pageSlice, ...relatedMethods]);
  }

  const covered = new Set(groups.flat().map((t) => t.id));
  const orphans = methods.filter((m) => !covered.has(m.id));
  if (orphans.length) {
    for (let i = 0; i < orphans.length; i += 12) {
      groups.push(orphans.slice(i, i + 12));
    }
  }
  return groups;
}

/**
 * UA-inspired enrich pipeline (WebPilot-owned):
 *   1. SCAN  — write scan-manifest.json from AST (test-framework focus)
 *   2. BATCH — LLM analysis-batch-NNN.json files
 *   3. MERGE — normalize, dedupe, remap, apply onto knowledge graph
 *
 * Fail-soft: AST graph is always preserved if LLM is unavailable.
 */
export class GraphLlmEnricher {
  public static async enrich(
    graph: RepoKnowledgeGraphData,
    options: GraphEnrichOptions = {}
  ): Promise<GraphEnrichResult> {
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

    // --- 1. SCAN ---
    const manifest = buildScanManifest(graph, { maxPages });
    const manifestPath = writeScanManifest(manifest);
    Logger.info(
      `[GraphEnrich] scan: ${manifest.stats.pages} pages, ${manifest.stats.methods} methods, ` +
        `${manifest.stats.targets} targets → ${manifestPath}`
    );

    if (manifest.targets.length === 0) {
      return {
        graph: {
          ...graph,
          sources: { ...graph.sources, llmEnrich: graph.sources.llmEnrich ?? false },
          notes: [
            ...graph.notes,
            'LLM enrich: nothing to enrich (no targets or contentHash unchanged).',
          ],
        },
        enrichedNodes: 0,
        batches: 0,
        skippedReason: 'no-targets',
        intermediateDir: KNOWLEDGE_INTERMEDIATE_ROOT,
      };
    }

    let llm: LLMClient;
    try {
      llm = options.llm ?? new LLMClient({ maxTokens: 8000, temperature: 0 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[GraphEnrich] LLM unavailable — keeping AST-only graph: ${message}`);
      return {
        graph: {
          ...graph,
          notes: [...graph.notes, `LLM enrich skipped: ${message}`],
        },
        enrichedNodes: 0,
        batches: 0,
        skippedReason: 'llm-unavailable',
        intermediateDir: KNOWLEDGE_INTERMEDIATE_ROOT,
      };
    }

    if (!options.keepBatches) {
      clearAnalysisBatches();
    }

    // --- 2. BATCH ---
    const groups = chunkPageGroups(manifest.targets, batchSize).slice(0, maxBatches);
    let batchesWritten = 0;

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const payload = group.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        filePath: t.filePath,
        signature: t.signature,
        parentId: t.parentId,
        // Skip large snippets for methods to keep completions under token limits
        snippet: t.type === 'method' ? undefined : readSnippet(t.filePath)?.slice(0, 900),
      }));

      const system = {
        role: 'system' as const,
        content:
          'You are WebPilot\'s repository graph analyzer for test automation codegen.\n' +
          'Return ONLY compact JSON (no markdown):\n' +
          '{"nodes":[{"id":"...","type":"page|method","summary":"1 sentence",' +
          '"intentTags":["fill","click"],"urlHint":"optional","relatedTo":[]}],"edges":[]}\n' +
          'Use exact ids. Keep summaries short. Prefer fewer edges.',
      };

      let nodes: AnalysisEnrichNode[] = [];
      let edges: AnalysisBatch['edges'] = [];
      let lastError = '';

      for (let attempt = 0; attempt < 2; attempt++) {
        const messages: LLMMessage[] = [
          system,
          {
            role: 'user',
            content:
              attempt === 0
                ? JSON.stringify({ batchIndex: i + 1, symbols: payload }, null, 2)
                : JSON.stringify(
                    {
                      batchIndex: i + 1,
                      note: 'Previous reply was truncated/invalid JSON. Return fewer nodes (pages only if needed) as valid JSON.',
                      symbols: payload.filter((p) => p.type !== 'method').slice(0, 3),
                    },
                    null,
                    2
                  ),
          },
        ];
        try {
          const response = await llm.complete(messages);
          const parsed = parseBatchResponse(response.text);
          nodes = parsed.nodes;
          edges = parsed.edges;
          lastError = '';
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          Logger.warn(`[GraphEnrich] batch ${i + 1} attempt ${attempt + 1} failed: ${lastError}`);
        }
      }

      if (lastError && !nodes.length) {
        writeAnalysisBatch({
          version: '1.0.0',
          batchIndex: i + 1,
          analyzedAt: new Date().toISOString(),
          targetIds: group.map((t) => t.id),
          nodes: [],
          edges: [],
          rawError: lastError,
        });
        // Continue other batches instead of aborting entire enrich
        continue;
      }

      const batch: AnalysisBatch = {
        version: '1.0.0',
        batchIndex: i + 1,
        analyzedAt: new Date().toISOString(),
        targetIds: group.map((t) => t.id),
        nodes,
        edges,
      };
      const batchPath = writeAnalysisBatch(batch);
      batchesWritten++;
      Logger.detail(
        `[GraphEnrich] batch ${i + 1}/${groups.length}: ${nodes.length} node enrichments → ${batchPath}`
      );
    }

    // --- 3. MERGE ---
    const batches = loadAnalysisBatches();
    const { graph: merged, report } = mergeEnrichmentBatches(graph, manifest, batches);
    const mergeReportPath = writeMergeReport(report);

    Logger.info(
      `[GraphEnrich] merge: applied ${report.appliedNodes} nodes / ${report.appliedEdges} edges ` +
        `(coverage pages ${report.enrichedCoverage.pagesWithSummary}/${report.enrichedCoverage.pagesTotal}) → ${mergeReportPath}`
    );

    return {
      graph: {
        ...merged,
        notes: [
          ...merged.notes,
          `Graph enrich pipeline: scan→${batchesWritten} batch(es)→merge under runtime/knowledge/intermediate/.`,
        ],
      },
      enrichedNodes: report.appliedNodes,
      batches: batchesWritten,
      intermediateDir: KNOWLEDGE_INTERMEDIATE_ROOT,
      mergeReportPath,
    };
  }
}
