#!/usr/bin/env node
/**
 * Feature 13: fixture lifecycle — manifest parsing, providers, manager, redaction.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const {
  FixtureManifestParser,
  FixtureManifestError,
  resolveFixturePath,
  FixtureLifecycleManager,
  SecretRegistry,
  shouldRunFixtureLifecycle,
  resolveFeatureFlags,
  CleanupStack,
} = require(path.join(root, 'dist/src/core/lifecycle/index.js'));
const { ConfigManager } = require(path.join(root, 'dist/src/core/ConfigManager.js'));

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

async function main() {
  // Path confinement
  let escaped = false;
  try {
    resolveFixturePath('../outside.yaml', root);
  } catch (err) {
    escaped = err instanceof FixtureManifestError || /escapes project root/.test(String(err.message));
  }
  assert(escaped, 'F13 rejects fixture paths outside project root');

  const checkoutPath = path.join(root, 'fixtures', 'checkout.yaml');
  assert(fs.existsSync(checkoutPath), 'F13 example checkout fixture exists');

  const manifest = FixtureManifestParser.parseFile('fixtures/checkout.yaml', root);
  assert(manifest.schemaVersion === 1, 'F13 parses schemaVersion 1');
  assert(manifest.seed && manifest.seed.provider === 'static-json', 'F13 checkout seed is static-json');
  assert(manifest.redaction?.fields?.includes('password'), 'F13 redaction fields parsed');

  let badSchema = false;
  try {
    FixtureManifestParser.parseContent('schemaVersion: 2\nname: x\n', 'bad');
  } catch {
    badSchema = true;
  }
  assert(badSchema, 'F13 rejects unknown schemaVersion');

  const tempManifest = FixtureManifestParser.parseFile('fixtures/temp-workspace.yaml', root);
  assert(tempManifest.seed?.provider === 'temp-dir', 'F13 parses temp-dir seed');

  // Secret registry
  const secrets = new SecretRegistry(['email']);
  secrets.register('password');
  const redacted = secrets.redactStructured({
    email: 'a@b.com',
    password: 'secret',
    cartItemSku: 'SKU-1',
  });
  assert(redacted.email === SecretRegistry.REDACTED, 'F13 SecretRegistry redacts email');
  assert(redacted.password === SecretRegistry.REDACTED, 'F13 SecretRegistry redacts password');
  assert(redacted.cartItemSku === 'SKU-1', 'F13 SecretRegistry keeps non-secret fields');

  // Lifecycle: static-json
  const session = await FixtureLifecycleManager.start({
    scenarioId: 'fixture_static_test',
    environment: 'qa',
    fixturePath: 'fixtures/checkout.yaml',
    projectRoot: root,
    variables: { baseUrl: 'https://example.com' },
  });
  assert(session.lease.variables.email === 'demo.user@example.com', 'F13 static seed merges email');
  assert(session.lease.variables.cartItemSku === 'SKU-DEMO-001', 'F13 static seed merges sku');
  assert(session.lease.context.isolationKey.includes('fixture_static_test'), 'F13 isolation key set');
  const teardown = await session.teardown();
  assert(Array.isArray(teardown), 'F13 teardown returns results');

  // Lifecycle: temp-dir creates and cleans
  const tempSession = await FixtureLifecycleManager.start({
    scenarioId: 'fixture_temp_test',
    environment: 'qa',
    fixturePath: 'fixtures/temp-workspace.yaml',
    projectRoot: root,
  });
  const tempDir = tempSession.lease.tempDir;
  assert(tempDir && fs.existsSync(tempDir), 'F13 temp-dir provider creates directory', tempDir);
  await tempSession.teardown();
  assert(!fs.existsSync(tempDir), 'F13 temp-dir cleanup removes directory');

  // shouldRunFixtureLifecycle
  const flags = resolveFeatureFlags(ConfigManager.getInstance());
  assert(
    shouldRunFixtureLifecycle(flags, 'fixtures/checkout.yaml') === true,
    'F13 scenario fixture path opts in lifecycle'
  );
  assert(
    shouldRunFixtureLifecycle({ ...flags, fixtureLifecycle: false }, '') === false,
    'F13 empty fixture path skips lifecycle'
  );

  // CleanupStack still works when composed with fixture teardown
  const order = [];
  const stack = new CleanupStack();
  stack.push('outer', () => {
    order.push('outer');
  });
  stack.push('inner', () => {
    order.push('inner');
  });
  await stack.drain();
  assert(order.join(',') === 'inner,outer', 'F13 nested cleanup LIFO');

  // HTTP seed parse shape
  const httpDoc = FixtureManifestParser.parseContent(
    `
schemaVersion: 1
seed:
  provider: http-seed
  method: POST
  url: "{{apiBaseUrl}}/users"
  bodyPath: fixtures/data/checkout-user.json
  cleanup:
    method: DELETE
    urlTemplate: "{{apiBaseUrl}}/users/{{id}}"
    idPath: id
`,
    'http-fixture'
  );
  assert(httpDoc.seed?.provider === 'http-seed', 'F13 parses http-seed manifest');
  assert(httpDoc.seed?.cleanup?.urlTemplate.includes('{{id}}'), 'F13 http-seed cleanup template');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
