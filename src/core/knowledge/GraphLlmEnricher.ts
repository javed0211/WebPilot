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
const DEFAULT_BATCH_SIZE = 5;

function extractJson(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```$/m, '').trim();
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = cleaned.slice(start, end + 1);
    if (slice.includes('"nodes"') || slice.includes("'nodes'")) return slice;
  }
  const arrStart = cleaned.indexOf('[');
  const arrEnd = cleaned.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) return cleaned.slice(arrStart, arrEnd + 1);
  return cleaned;
}

function chunkPageGroups(targets: ScanTarget[], batchSize: number): ScanTarget[][] {
  const pages = targets.filter((t) => t.type === 'page' || t.type === 'class');
  const methods = targets.filter((t) => t.type === 'method');
  const groups: ScanTarget[][] = [];

  for (let i = 0; i < pages.length; i += batchSize) {
    const pageSlice = pages.slice(i, i + batchSize);
    const pageIds = new Set(pageSlice.map((p) => p.id));
    const relatedMethods = methods.filter(
      (m) => m.parentId && pageIds.has(m.parentId)
    );
    groups.push([...pageSlice, ...relatedMethods.slice(0, batchSize * 12)]);
  }

  // Orphan methods (no parent page in targets) — rare
  const covered = new Set(groups.flat().map((t) => t.id));
  const orphans = methods.filter((m) => !covered.has(m.id));
  if (orphans.length) {
    for (let i = 0; i < orphans.length; i += 20) {
      groups.push(orphans.slice(i, i + 20));
    }
  }
  return groups;
}

function parseBatchResponse(text: string): {
  nodes: AnalysisEnrichNode[];
  edges: AnalysisBatch['edges'];
} {
  const parsed = JSON.parse(extractJson(text));
  if (Array.isArray(parsed)) {
    return { nodes: parsed as AnalysisEnrichNode[], edges: [] };
  }
  return {
    nodes: Array.isArray(parsed?.nodes) ? parsed.nodes : Array.isArray(parsed?.items) ? parsed.items : [],
    edges: Array.isArray(parsed?.edges) ? parsed.edges : [],
  };
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
      llm = options.llm ?? new LLMClient({ maxTokens: 5000, temperature: 0 });
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
        snippet: t.type === 'method' ? undefined : readSnippet(t.filePath),
      }));

      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            'You are WebPilot\'s repository graph analyzer for test automation codegen.\n' +
            'Given structural symbols (page objects / methods), return ONLY JSON:\n' +
            '{"nodes":[{"id":"...","type":"page|method","summary":"1-2 sentences for reuse",' +
            '"intentTags":["fill","click","navigate"],"urlHint":"optional host or path",' +
            '"domain":"optional","layer":"optional","relatedTo":["id or class name"]}],' +
            '"edges":[{"source":"...","target":"...","type":"semantic|related|depends_on"}]}\n' +
            'Rules: use exact ids from input; summaries must help an agent reuse existing APIs; ' +
            'prefer intentTags that match Playwright actions; do not invent new page class names.',
        },
        {
          role: 'user',
          content: JSON.stringify({ batchIndex: i + 1, symbols: payload }, null, 2),
        },
      ];

      try {
        const response = await llm.complete(messages);
        const { nodes, edges } = parseBatchResponse(response.text);
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.warn(`[GraphEnrich] batch ${i + 1} failed — merging partial results: ${message}`);
        writeAnalysisBatch({
          version: '1.0.0',
          batchIndex: i + 1,
          analyzedAt: new Date().toISOString(),
          targetIds: group.map((t) => t.id),
          nodes: [],
          edges: [],
          rawError: message,
        });
        break;
      }
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
