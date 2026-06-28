#!/usr/bin/env node
/**
 * Integration checks for Feature 01 (deterministic codegen) and Feature 02 (selector intelligence).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const slug = 'feature01_smoke';

const results = [];
function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
}
function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
}

function assert(cond, name, detail) {
  if (cond) pass(name, detail);
  else fail(name, detail);
}

async function main() {
  const historyPath = path.join(
    root,
    'runtime/reports/data/execution-history',
    `${slug}_execution_history.json`
  );
  const tracePath = path.join(root, 'runtime/codegen/traces', `${slug}.json`);

  if (!fs.existsSync(historyPath) && fs.existsSync(tracePath)) {
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
    const executionHistory = trace.steps.map((step) => ({
      index: step.index,
      action: step.action,
      selector: step.selector?.expression || step.selector?.value || null,
      value: step.value || null,
      url: step.url || null,
      description: step.description,
    }));
    fs.writeFileSync(
      historyPath,
      JSON.stringify(
        {
          testName: trace.scenario,
          scenario: trace.scenario,
          executionHistory,
        },
        null,
        2
      ),
      'utf8'
    );
    pass('Seed execution history from trace', historyPath);
  }

  const { SelectorRanker } = require(path.join(root, 'dist/src/core/selectors/SelectorRanker.js'));

  const role = SelectorRanker.candidate('role', "button[name='Add to cart']");
  const css = SelectorRanker.candidate('css', 'div:nth-child(3) > button');
  const xpath = SelectorRanker.candidate('xpath', '//button[3]');
  const testId = SelectorRanker.candidate('testid', 'add-to-cart');

  assert(role.confidence > css.confidence, 'F02 role outranks brittle CSS', `${role.confidence} > ${css.confidence}`);
  assert(testId.confidence > css.confidence, 'F02 testid outranks brittle CSS', `${testId.confidence} > ${css.confidence}`);
  assert(xpath.confidence < css.confidence, 'F02 xpath scores lower than css', `${xpath.confidence} < ${css.confidence}`);

  const ranked = SelectorRanker.rank([css, role, testId]);
  assert(ranked?.primary.kind === 'role', 'F02 ranker picks role as primary', ranked?.primary.kind);

  const { TraceBuilder } = require(path.join(root, 'dist/src/core/codegen/TraceBuilder.js'));
  const trace = TraceBuilder.build({
    scenario: 'AutomationExercise smoke',
    scenarioSlug: slug,
    steps: JSON.parse(fs.readFileSync(historyPath, 'utf8')).executionHistory,
    targetUrl: 'https://automationexercise.com/',
  });

  const clickStep = trace.steps.find((s) => s.action === 'click');
  assert(!!clickStep?.selector?.confidence, 'F02 trace step has selector confidence', String(clickStep?.selector?.confidence));
  assert(clickStep?.selector?.kind === 'role', 'F02 trace prefers role selector', clickStep?.selector?.kind);
  assert((clickStep?.selector?.signals?.length || 0) > 0, 'F02 trace records selector signals');

  const registryPath = path.join(root, 'runtime/selectors/registry.json');
  assert(fs.existsSync(registryPath), 'F02 selector registry exists', registryPath);

  const { DeterministicCodegenPipeline } = require(
    path.join(root, 'dist/src/core/codegen/DeterministicCodegenPipeline.js')
  );

  const pipelineResult = await DeterministicCodegenPipeline.runFromSlug(slug, { validate: false });
  const specFile = pipelineResult.files.find((f) => f.path.endsWith('.spec.ts'));

  assert(!!specFile, 'F01 generates Playwright spec', specFile?.path);
  assert(
    specFile?.content.includes('getByRole') || specFile?.content.includes('automationExerciseHomePage'),
    'F01 spec uses strong selectors or page object methods'
  );
  assert(!!pipelineResult.metadata.replayCommand, 'F01 metadata includes replay command');
  assert(
    (pipelineResult.metadata.pageObjectPaths?.length || 0) > 0,
    'F01 metadata links page objects',
    pipelineResult.metadata.pageObjectPaths?.join(', ')
  );
  assert(fs.existsSync(path.join(root, pipelineResult.metadata.sourceTrace)), 'F01 trace persisted');
  assert(fs.existsSync(path.join(root, pipelineResult.metadata.sourcePlan)), 'F01 plan persisted');

  if (specFile?.content.includes('confidence')) {
    pass('F02 generated spec includes selector confidence comments');
  } else if (specFile?.content.includes('automationExerciseHomePage')) {
    pass('F01 spec delegates to page object methods (selector intel in POM layer)');
  }

  const proposalDir = path.join(root, 'runtime/selectors/healing-proposals');
  fs.mkdirSync(proposalDir, { recursive: true });
  const proposalPath = path.join(proposalDir, 'test-proposal.json');
  const tempTarget = path.join(root, 'runtime/selectors/test-heal-target.ts');
  const oldSel = "page.getByText('Products')";
  const newSel = "page.getByRole('link', { name: 'Products' })";
  fs.writeFileSync(
    proposalPath,
    JSON.stringify({ oldSelector: oldSel, newSelector: newSel, reasoning: 'Test proposal', confidence: 0.9 }, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    tempTarget,
    `export async function clickProducts(page: any) {\n  await ${oldSel}.click();\n}\n`,
    'utf8'
  );

  const apply = spawnSync(
    process.execPath,
    [path.join(root, 'dist/src/cli/index.js'), 'self-heal', '--apply', proposalPath, '--file', tempTarget],
    { cwd: root, encoding: 'utf8' }
  );
  const patched = fs.readFileSync(tempTarget, 'utf8');
  assert(apply.status === 0, 'F02 self-heal --apply exits 0');
  assert(patched.includes(newSel) && !patched.includes(oldSel), 'F02 self-heal patches explicit target');

  const list = spawnSync(
    process.execPath,
    [path.join(root, 'dist/src/cli/index.js'), 'self-heal', '--proposals'],
    { cwd: root, encoding: 'utf8' }
  );
  assert(list.status === 0 && list.stdout.includes('test-proposal.json'), 'F02 self-heal --proposals lists proposal');

  const summaryPath = path.join(root, 'runtime/reports/data/summaries', `${slug}_summary.json`);
  if (!fs.existsSync(summaryPath) && pipelineResult.metadata) {
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    const reportCodegen = DeterministicCodegenPipeline.toReportCodegen(
      pipelineResult.metadata,
      pipelineResult.plan
    );
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          test: slug,
          testName: trace.scenario,
          status: 'PASSED',
          summary: 'Deterministic codegen test',
          codegen: reportCodegen,
        },
        null,
        2
      ),
      'utf8'
    );
  }

  if (fs.existsSync(summaryPath)) {
    const { collectTestCaseReport } = require(path.join(root, 'dist/src/core/execution_report/collector.js'));
    const report = collectTestCaseReport(slug);
    assert(!!report?.codegen?.specPath, 'F01 report collector exposes codegen.specPath', report?.codegen?.specPath);
    assert(!!report?.codegen?.replayCommand, 'F01 report collector exposes replayCommand');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n--- ${results.length - failed.length}/${results.length} checks passed ---`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
