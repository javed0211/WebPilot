/**
 * Phase 4: knowledge-only prefers Playwright; canonical POMs are opt-in.
 * Run: npm run build && node scripts/test-knowledge-only-replay.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const {
  KnowledgeOnlyReplay,
} = require(path.join(root, 'dist/src/core/replay/KnowledgeOnlyReplay.js'));
const {
  CodegenNormalizer,
} = require(path.join(root, 'dist/src/core/CodegenNormalizer.js'));

function testPlanUnavailableWithoutHistory() {
  const slug = `missing_${Date.now()}`;
  const plan = KnowledgeOnlyReplay.plan(slug);
  assert.strictEqual(plan.strategy, 'unavailable');
  assert.ok(/deprecated/i.test(plan.reason) || /No Playwright/i.test(plan.reason));
}

function testPlanPrefersActHistory() {
  const slug = `ko_act_${Date.now()}`;
  const dir = path.join(root, 'runtime', 'reports', 'data', 'execution-history');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}_execution_history.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({
      testName: slug,
      historySource: 'browser-use-act-history',
      actHistory: [
        {
          index: 1,
          action: 'navigate',
          url: 'https://example.com/',
          value: 'https://example.com/',
          description: 'navigate',
        },
      ],
    }),
    'utf8'
  );
  try {
    const plan = KnowledgeOnlyReplay.plan(slug);
    assert.strictEqual(plan.strategy, 'act-history');
  } finally {
    fs.unlinkSync(file);
  }
}

function testPlanPrefersSpecOverHistory() {
  const slug = `ko_spec_${Date.now()}`;
  const dir = path.join(root, 'runtime', 'reports', 'data', 'execution-history');
  fs.mkdirSync(dir, { recursive: true });
  const hist = path.join(dir, `${slug}_execution_history.json`);
  fs.writeFileSync(
    hist,
    JSON.stringify({
      actHistory: [{ index: 1, action: 'navigate', url: 'https://example.com/', description: 'n' }],
    }),
    'utf8'
  );
  const specDir = path.join(root, 'packages', 'test-framework', 'tests');
  fs.mkdirSync(specDir, { recursive: true });
  const spec = path.join(specDir, `${slug}.spec.ts`);
  fs.writeFileSync(spec, "import { test } from '@playwright/test';\ntest('x', async () => {});", 'utf8');
  try {
    const plan = KnowledgeOnlyReplay.plan(slug);
    assert.strictEqual(plan.strategy, 'spec');
    assert.ok(plan.specPath && plan.specPath.includes(`${slug}.spec.ts`));
  } finally {
    fs.unlinkSync(hist);
    fs.unlinkSync(spec);
  }
}

function testNormalizerDoesNotReplaceByDefault() {
  delete process.env.WEBPILOT_CANONICAL_POMS;
  const files = [
    {
      path: 'packages/test-framework/pages/automationexercise/FooPage.ts',
      content: 'export class FooPage {}',
    },
    {
      path: 'packages/test-framework/tests/automationexercise-search-product.spec.ts',
      content: "import { FooPage } from '@pages/automationexercise/FooPage';",
    },
  ];
  const out = CodegenNormalizer.normalize(files, { testSlug: 'automationexercise-search-product' });
  const page = out.find((f) => f.path.includes('FooPage'));
  assert.ok(page);
  assert.strictEqual(page.content, 'export class FooPage {}');
  const spec = out.find((f) => f.path.endsWith('.spec.ts'));
  assert.ok(spec.content.includes("../pages/automationexercise/FooPage"));
}

function testNormalizerCanonicalOptIn() {
  process.env.WEBPILOT_CANONICAL_POMS = '1';
  try {
    const files = [
      {
        path: 'packages/test-framework/pages/automationexercise/FooPage.ts',
        content: 'export class FooPage {}',
      },
    ];
    const out = CodegenNormalizer.normalize(files, {
      testSlug: 'automationexercise-search-product',
      urls: ['https://www.automationexercise.com/'],
    });
    assert.ok(out.some((f) => f.path.includes('AutomationExerciseHomePage')));
  } finally {
    delete process.env.WEBPILOT_CANONICAL_POMS;
  }
}

testPlanUnavailableWithoutHistory();
testPlanPrefersActHistory();
testPlanPrefersSpecOverHistory();
testNormalizerDoesNotReplaceByDefault();
testNormalizerCanonicalOptIn();
console.log('test-knowledge-only-replay: ok');
