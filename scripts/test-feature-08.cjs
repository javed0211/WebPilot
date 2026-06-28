#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const { ScenarioMetadataParser } = require(path.join(
  root,
  'dist/src/core/authoring/ScenarioMetadata.js'
));
const { TestTemplateRegistry } = require(path.join(
  root,
  'dist/src/core/authoring/TestTemplates.js'
));
const { AuthoringOutput } = require(path.join(root, 'dist/src/core/authoring/NextSteps.js'));
const { ApiTestParser } = require(path.join(root, 'dist/src/core/api/ApiTestParser.js'));

const results = [];
function pass(name, detail = '') {
  results.push({ ok: true, name });
  console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
}
function fail(name, detail = '') {
  results.push({ ok: false, name });
  console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
}
function assert(condition, name, detail = '') {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

const hybrid = ScenarioMetadataParser.parse(`@smoke @checkout
target: web
baseUrl: https://automationexercise.com
codegen: true
report: yes

Test: Add product to cart

1. Navigate to the store
2. Add product to cart
`);

assert(hybrid.format === 'hybrid-metadata', 'F08 parser detects hybrid metadata', hybrid.format);
assert(hybrid.tags.includes('@smoke') && hybrid.tags.includes('@checkout'), 'F08 parser extracts tags');
assert(hybrid.target === 'web', 'F08 parser extracts target', hybrid.target);
assert(hybrid.baseUrl === 'https://automationexercise.com', 'F08 parser extracts baseUrl', hybrid.baseUrl);
assert(hybrid.codegen === true && hybrid.report === true, 'F08 parser extracts codegen/report booleans');
assert(hybrid.name === 'Add product to cart', 'F08 parser extracts test name', hybrid.name);

const bdd = ScenarioMetadataParser.parse(`Feature: Checkout

Scenario: Add product to cart
  Given I am on the products page
  When I add the first product to the cart
  Then I should see it in the cart
`);
assert(bdd.format === 'bdd', 'F08 parser detects BDD format', bdd.format);
assert(bdd.name === 'Add product to cart', 'F08 BDD parser prefers scenario name', bdd.name);

assert(
  JSON.stringify(ScenarioMetadataParser.parseTags('@smoke @checkout')) ===
    JSON.stringify(['@smoke', '@checkout']),
  'F08 tag parser extracts tag list'
);

const checkoutTemplate = TestTemplateRegistry.render('checkout-flow', {
  name: 'checkout flow',
  baseUrl: 'https://example.test',
});
assert(checkoutTemplate.includes('@checkout'), 'F08 checkout template includes checkout tag');
assert(checkoutTemplate.includes('codegen: true'), 'F08 web templates enable codegen metadata');
assert(checkoutTemplate.includes('report: true'), 'F08 web templates enable report metadata');
assert(checkoutTemplate.includes('https://example.test/'), 'F08 template uses supplied base URL');

const apiTemplate = TestTemplateRegistry.render('api-smoke', { name: 'petstore smoke' });
assert(apiTemplate.includes('target: api'), 'F08 API template includes target metadata');

const apiSteps = ApiTestParser.parsePlainTextSteps(`@api @smoke
target: api
report: true
Test: API metadata skip

Send GET request to https://petstore.swagger.io/v2/pet/1
Assert status is 200
`);
assert(apiSteps.length === 1, 'F08 API parser ignores authoring metadata lines', String(apiSteps.length));
assert(apiSteps[0]?.method === 'GET', 'F08 API parser still reads request after metadata');

const nextSteps = AuthoringOutput.block(
  AuthoringOutput.createdTest('tests/web/checkout.txt', {
    runCommand: 'webpilot run tests/web/checkout.txt --codegen --report',
  })
);
assert(nextSteps.includes('Next steps:'), 'F08 output helper renders block title');
assert(nextSteps.includes('webpilot run tests/web/checkout.txt'), 'F08 output helper includes run command');

const generatedPath = path.join(root, 'tests/web/feature08_checkout_cli.txt');
if (fs.existsSync(generatedPath)) fs.unlinkSync(generatedPath);
const create = spawnSync(
  process.execPath,
  [
    'dist/src/cli/index.js',
    'create',
    'test',
    'feature08_checkout_cli',
    '--template',
    'checkout-flow',
    '--base-url',
    'https://example.test',
  ],
  { cwd: root, encoding: 'utf8' }
);
assert(create.status === 0, 'F08 create test command exits 0', create.stderr);
assert(fs.existsSync(generatedPath), 'F08 create test writes requested file');
const generated = fs.existsSync(generatedPath) ? fs.readFileSync(generatedPath, 'utf8') : '';
assert(generated.includes('@checkout'), 'F08 create test uses requested template');
assert(create.stdout.includes('Next steps:'), 'F08 create test prints next-step guidance');
if (fs.existsSync(generatedPath)) fs.unlinkSync(generatedPath);

const failed = results.filter((item) => !item.ok);
console.log(`\nFeature 08 checks: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
