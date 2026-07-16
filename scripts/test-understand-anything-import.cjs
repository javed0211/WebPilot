#!/usr/bin/env node
/**
 * Smoke test for Understand-Anything graph import helpers.
 * Run after `npm run build`: node scripts/test-understand-anything-import.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const {
  parseUnderstandAnythingPayload,
  resolveUnderstandAnythingGraphPath,
} = require(path.join(root, 'dist/src/core/knowledge/RepoKnowledgeGraph.js'));

function testParseNativeUaShape() {
  const parsed = parseUnderstandAnythingPayload({
    version: '1.0.0',
    nodes: [
      {
        id: 'class:pages/wikipedia/WikipediaHomePage.ts#WikipediaHomePage',
        type: 'class',
        name: 'WikipediaHomePage',
        filePath: 'packages/test-framework/pages/wikipedia/WikipediaHomePage.ts',
        summary: 'Home page for Wikipedia search and article navigation.',
        urlPattern: 'wikipedia\\.org',
      },
      {
        id: 'file:src/cli/index.ts',
        kind: 'file',
        label: 'cli',
        path: 'src/cli/index.ts',
        summary: 'WebPilot CLI entrypoint.',
      },
      {
        id: 'domain:search',
        kind: 'concept',
        label: 'Search',
        summary: 'User finds content via search box.',
      },
    ],
    edges: [
      {
        from: 'file:src/cli/index.ts',
        to: 'class:pages/wikipedia/WikipediaHomePage.ts#WikipediaHomePage',
        kind: 'depends_on',
      },
      {
        source: 'class:pages/wikipedia/WikipediaHomePage.ts#WikipediaHomePage',
        target: 'domain:search',
        type: 'references',
      },
    ],
  });

  assert.strictEqual(parsed.nodes.length, 3);
  assert.strictEqual(parsed.edges.length, 2);

  const page = parsed.nodes.find((n) => n.name === 'WikipediaHomePage');
  assert.ok(page, 'expected WikipediaHomePage node');
  assert.strictEqual(page.type, 'page');
  assert.strictEqual(page.meta.urlPattern, 'wikipedia\\.org');
  assert.ok(String(page.meta.summary).includes('Wikipedia'));

  const domain = parsed.nodes.find((n) => n.name === 'Search');
  assert.ok(domain);
  assert.strictEqual(domain.type, 'domain');

  assert.ok(parsed.summaries.get('wikipediahomepage'));
  assert.ok(parsed.summaries.get('packages/test-framework/pages/wikipedia/wikipediahomepage.ts'));

  const edgeTypes = parsed.edges.map((e) => e.type).sort();
  assert.deepStrictEqual(edgeTypes, ['depends_on', 'depends_on']);
}

function testResolvePrefersLegacyWhenPresent() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webpilot-ua-'));
  try {
    const legacyDir = path.join(tmp, '.understand-anything');
    const uaDir = path.join(tmp, '.ua');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.mkdirSync(uaDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'knowledge-graph.json'), '{"nodes":[],"edges":[]}');
    fs.writeFileSync(path.join(uaDir, 'knowledge-graph.json'), '{"nodes":[],"edges":[]}');

    const resolved = resolveUnderstandAnythingGraphPath(tmp);
    assert.strictEqual(resolved, path.join(legacyDir, 'knowledge-graph.json'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testResolveFallsBackToUa() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webpilot-ua-'));
  try {
    const uaDir = path.join(tmp, '.ua');
    fs.mkdirSync(uaDir, { recursive: true });
    fs.writeFileSync(path.join(uaDir, 'knowledge-graph.json'), '{"nodes":[],"edges":[]}');

    const resolved = resolveUnderstandAnythingGraphPath(tmp);
    assert.strictEqual(resolved, path.join(uaDir, 'knowledge-graph.json'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

testParseNativeUaShape();
testResolvePrefersLegacyWhenPresent();
testResolveFallsBackToUa();
console.log('test-understand-anything-import: ok');
