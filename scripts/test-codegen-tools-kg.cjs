#!/usr/bin/env node
/**
 * Smoke test for architecture detect + CodegenTools over WebPilot KG.
 * Run after `npm run build`: node scripts/test-codegen-tools-kg.cjs
 */
const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const {
  architectureToFrameworkPattern,
  frameworkPatternToArchitecture,
  resolveCodegenArchitecture,
  detectRepoArchitecture,
} = require(path.join(root, 'dist/src/core/knowledge/RepoArchitectureDetect.js'));
const { CodegenTools } = require(path.join(root, 'dist/src/core/knowledge/CodegenTools.js'));
const { RepoKnowledgeGraph } = require(path.join(root, 'dist/src/core/knowledge/RepoKnowledgeGraph.js'));

function testArchitectureMaps() {
  assert.strictEqual(architectureToFrameworkPattern('flat'), 'simple');
  assert.strictEqual(frameworkPatternToArchitecture('simple'), 'flat');
  const overridden = resolveCodegenArchitecture({ override: 'bdd' });
  assert.strictEqual(overridden.architecture, 'bdd');
  const detected = detectRepoArchitecture();
  assert.ok(['flat', 'pom', 'bdd', 'pom-bdd'].includes(detected.architecture));
  console.log(`  architecture detect → ${detected.architecture} (${detected.confidence})`);
}

function testCodegenTools() {
  const graph = RepoKnowledgeGraph.build();
  assert.ok(graph.nodes.length > 0, 'expected AST graph nodes');
  const tools = new CodegenTools(undefined, graph);
  const search = tools.kgSearch('page');
  assert.strictEqual(search.ok, true);
  const arch = tools.detectArchitecture();
  assert.ok(arch.text.includes('architecture='));
  const pages = tools.listPages();
  assert.strictEqual(pages.ok, true);
  console.log(`  kg pages indexed: ${graph.stats.pages}, search ok, detect ok`);
}

async function main() {
  console.log('test-codegen-tools-kg');
  testArchitectureMaps();
  testCodegenTools();
  console.log('OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
