#!/usr/bin/env node
/**
 * Smoke test for scan → merge (no LLM required).
 * Run after `npm run build`: node scripts/test-graph-enrich-merge.cjs
 */
const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const { buildScanManifest } = require(path.join(
  root,
  'dist/src/core/knowledge/graphEnrich/scanManifest.js'
));
const { mergeAnalysisNodes } = require(path.join(
  root,
  'dist/src/core/knowledge/graphEnrich/mergeEnrichment.js'
));
const { RepoKnowledgeGraph } = require(path.join(
  root,
  'dist/src/core/knowledge/RepoKnowledgeGraph.js'
));

function testScanManifest() {
  const graph = RepoKnowledgeGraph.build();
  const manifest = buildScanManifest(graph, { maxPages: 10 });
  assert.strictEqual(manifest.kind, 'codegen');
  assert.ok(manifest.stats.pages >= 0);
  assert.ok(Array.isArray(manifest.targets));
  console.log(
    `  scan: pages=${manifest.stats.pages} methods=${manifest.stats.methods} targets=${manifest.stats.targets}`
  );
}

function testMergeDedupeAndRemap() {
  const graph = {
    version: '1.2.0',
    generatedAt: new Date().toISOString(),
    root: root,
    profile: {},
    sources: {
      typescriptCompiler: true,
      symbolParser: true,
      understandAnything: false,
      treeSitter: false,
      llmEnrich: false,
    },
    stats: {
      files: 1,
      pages: 1,
      tests: 0,
      apis: 0,
      classes: 0,
      functions: 0,
      methods: 1,
      imports: 0,
      externalDependencies: 0,
      edges: 1,
      enriched: 0,
      importedNodes: 0,
      importedEdges: 0,
    },
    notes: [],
    nodes: [
      {
        id: 'page:pages/demo/DemoPage.ts#DemoPage',
        type: 'page',
        name: 'DemoPage',
        filePath: 'packages/test-framework/pages/demo/DemoPage.ts',
        meta: {},
      },
      {
        id: 'method:pages/demo/DemoPage.ts#fillSearch',
        type: 'method',
        name: 'fillSearch',
        filePath: 'packages/test-framework/pages/demo/DemoPage.ts',
        meta: {},
      },
    ],
    edges: [
      {
        from: 'page:pages/demo/DemoPage.ts#DemoPage',
        to: 'method:pages/demo/DemoPage.ts#fillSearch',
        type: 'contains',
      },
    ],
  };

  const { graph: merged, report } = mergeAnalysisNodes(
    graph,
    [
      {
        id: 'page:pages/demo/DemoPage.ts#DemoPage',
        type: 'page',
        summary: 'Demo home page for search.',
        intentTags: ['navigate'],
        urlHint: 'demo.example',
        relatedTo: ['fillSearch'], // remap by name
      },
      {
        id: 'method:pages/demo/DemoPage.ts#fillSearch',
        type: 'method',
        summary: 'Fills the search box.',
        intentTags: ['fill'],
      },
      // duplicate-ish second apply via edges
    ],
    [
      {
        source: 'page:pages/demo/DemoPage.ts#DemoPage',
        target: 'method:pages/demo/DemoPage.ts#fillSearch',
        type: 'semantic',
      },
      // duplicate edge
      {
        source: 'page:pages/demo/DemoPage.ts#DemoPage',
        target: 'method:pages/demo/DemoPage.ts#fillSearch',
        type: 'semantic',
      },
      // dangling
      {
        source: 'page:pages/demo/DemoPage.ts#DemoPage',
        target: 'missing:nowhere',
        type: 'related',
      },
    ]
  );

  const page = merged.nodes.find((n) => n.name === 'DemoPage');
  assert.ok(page.meta.summary.includes('Demo home'));
  assert.strictEqual(page.meta.enrichedBy, 'webpilot-llm');
  assert.ok(report.appliedNodes >= 2);
  assert.ok(report.dedupedEdges >= 1 || report.droppedEdges >= 1);
  assert.ok(report.remappedRelated >= 1 || report.appliedEdges >= 1);
  console.log(
    `  merge: appliedNodes=${report.appliedNodes} edges=${report.appliedEdges} ` +
      `deduped=${report.dedupedEdges} dropped=${report.droppedEdges} remapped=${report.remappedRelated}`
  );
}

function main() {
  console.log('test-graph-enrich-merge');
  testScanManifest();
  testMergeDedupeAndRemap();
  console.log('OK');
}

main();
