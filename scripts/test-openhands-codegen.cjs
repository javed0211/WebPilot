const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function main() {
  const root = process.cwd();
  process.env.WEBPILOT_PROJECT_ROOT = root;
  process.env.WEBPILOT_INSTALL_ROOT = root;
  process.env.WEBPILOT_OPENHANDS_MOCK = '1';
  process.env.WEBPILOT_CODEGEN_MODE = 'openhands';

  const slug = 'booking_home_visibility_smoke';
  const historyPath = path.join(
    root,
    'runtime',
    'reports',
    'data',
    'execution-history',
    `${slug}_execution_history.json`
  );
  assert.ok(fs.existsSync(historyPath), `Missing fixture history: ${historyPath}`);

  const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  const specPath = path.join(root, 'packages', 'test-framework', 'tests', `${slug}.spec.ts`);
  const pagePath = path.join(root, 'packages', 'test-framework', 'pages', `${slug}.page.ts`);

  for (const target of [specPath, pagePath]) {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }

  const { runPostExecutionCodegen } = require('../dist/src/core/codegen/PostExecutionCodegen.js');
  const result = await runPostExecutionCodegen({
    testName: slug,
    testFilePath: path.join(root, 'tests', 'web', `${slug}.txt`),
    executionHistory: history.actHistory || history.executionHistory || [],
    llmClient: {},
    architecture: 'pom',
    validate: false,
    historyDocument: history,
  });

  assert.equal(result.success, true, result.summary);
  assert.ok(fs.existsSync(specPath), `Expected spec file: ${specPath}`);
  assert.ok(fs.existsSync(pagePath), `Expected page file: ${pagePath}`);
  assert.ok(Array.isArray(result.files) && result.files.length >= 2, 'Expected changed files in result');

  console.log('OpenHands mock codegen smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
