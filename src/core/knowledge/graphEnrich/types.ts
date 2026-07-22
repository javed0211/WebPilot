/**
 * Types for WebPilot's UA-inspired scan → batch → merge enrich pipeline.
 * Owned by WebPilot — no Understand-Anything runtime dependency.
 */

export type EnrichNodeType = 'page' | 'class' | 'method' | 'test' | 'domain' | 'unknown';

export interface ScanTarget {
  id: string;
  name: string;
  type: EnrichNodeType | string;
  filePath?: string;
  signature?: string;
  /** Hash of file snippet used for incremental skip. */
  contentHash?: string;
  parentId?: string;
  methodIds?: string[];
}

export interface ScanManifest {
  version: string;
  kind: 'codegen';
  generatedAt: string;
  root: string;
  focus: string;
  nodes: Array<{
    id: string;
    type: string;
    name: string;
    filePath?: string;
    signature?: string;
    contentHash?: string;
  }>;
  edges: Array<{ source: string; target: string; type: string }>;
  targets: ScanTarget[];
  stats: {
    pages: number;
    methods: number;
    tests: number;
    targets: number;
  };
}

export interface AnalysisEnrichNode {
  id: string;
  type?: string;
  name?: string;
  summary?: string;
  intentTags?: string[];
  urlHint?: string;
  layer?: string;
  domain?: string;
  relatedTo?: string[];
}

export interface AnalysisEnrichEdge {
  source: string;
  target: string;
  type?: string;
  weight?: number;
}

export interface AnalysisBatch {
  version: string;
  batchIndex: number;
  analyzedAt: string;
  targetIds: string[];
  nodes: AnalysisEnrichNode[];
  edges: AnalysisEnrichEdge[];
  rawError?: string;
}

export interface MergeReport {
  generatedAt: string;
  baseNodes: number;
  batches: number;
  appliedNodes: number;
  appliedEdges: number;
  dedupedEdges: number;
  droppedEdges: number;
  remappedRelated: number;
  skippedUnknownTypes: number;
  enrichedCoverage: {
    pagesWithSummary: number;
    pagesTotal: number;
    methodsWithSummary: number;
    methodsTotal: number;
  };
}

export const VALID_ENRICH_NODE_TYPES = new Set([
  'page',
  'class',
  'method',
  'test',
  'domain',
  'file',
  'function',
  'unknown',
]);

export const VALID_ENRICH_EDGE_TYPES = new Set([
  'semantic',
  'related',
  'depends_on',
  'references',
  'calls',
  'contains',
  'extends',
]);

export const NODE_TYPE_ALIASES: Record<string, string> = {
  pageobject: 'page',
  page_object: 'page',
  pom: 'page',
  cls: 'class',
  fn: 'function',
  meth: 'method',
  concept: 'domain',
};

export const EDGE_TYPE_ALIASES: Record<string, string> = {
  relates_to: 'related',
  related_to: 'related',
  similar_to: 'related',
  references: 'references',
  cites: 'references',
  uses: 'depends_on',
  depends: 'depends_on',
};
