#!/usr/bin/env node
/**
 * Smoke-test: resolve bundled @microsoft/dataverse entry and build launch spec
 * without connecting to a live org.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
process.chdir(root);

const {
  resolveBundledDataverseEntry,
  buildDataverseMcpLaunchSpec,
} = require('../dist/src/integrations/dataverse/DataverseMcpLauncher');
const { normalizeEnvironmentUrl, mcpEndpoint } = require('../dist/src/integrations/dataverse/DataverseConfig');

const entry = resolveBundledDataverseEntry();
assert.ok(fs.existsSync(entry), `missing entry: ${entry}`);
assert.ok(entry.includes('@microsoft/dataverse'), entry);

assert.strictEqual(
  normalizeEnvironmentUrl('contoso.crm.dynamics.com/'),
  'https://contoso.crm.dynamics.com'
);
assert.strictEqual(
  mcpEndpoint('https://contoso.crm.dynamics.com', true),
  'https://contoso.crm.dynamics.com/api/mcp_preview'
);

const launch = buildDataverseMcpLaunchSpec({
  enabled: true,
  environmentUrl: 'https://contoso.crm.dynamics.com',
  preview: true,
  timeoutMs: 60_000,
});
assert.strictEqual(launch.command, process.execPath);
assert.ok(launch.args.includes('mcp'));
assert.ok(launch.args.includes('https://contoso.crm.dynamics.com'));
assert.ok(launch.args.includes('--preview'));
assert.strictEqual(launch.preview, true);

console.log('dataverse-mcp-launcher OK');
console.log(`  entry: ${entry}`);
console.log(`  args:  ${launch.args.join(' ')}`);
