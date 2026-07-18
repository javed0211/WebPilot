#!/usr/bin/env node
/**
 * Smoke tests for ADO MCP launcher arg construction (no live ADO calls).
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { resolveBundledMcpEntry, buildAdoMcpLaunchSpec } = require('../dist/src/integrations/ado/AdoMcpLauncher');
const { parseMcpToolPayload } = require('../dist/src/integrations/ado/AdoMcpService');

function main() {
  const entry = resolveBundledMcpEntry(path.resolve(__dirname, '..'));
  assert.ok(fs.existsSync(entry), `bundled MCP entry missing: ${entry}`);
  assert.ok(entry.includes('@azure-devops/mcp'), `unexpected entry path: ${entry}`);

  const launch = buildAdoMcpLaunchSpec({
    enabled: true,
    organization: 'contoso',
    project: 'Web',
    auth: 'pat',
    domains: ['core', 'work-items', 'test-plans'],
    timeoutMs: 30_000,
  });

  assert.strictEqual(launch.command, process.execPath);
  assert.ok(launch.args[0].includes('@azure-devops/mcp'));
  assert.strictEqual(launch.args[1], 'contoso');
  assert.ok(launch.args.includes('--authentication'));
  assert.ok(launch.args.includes('envvar'));
  assert.ok(launch.args.includes('-d'));
  assert.ok(launch.args.includes('test-plans'));
  assert.strictEqual(launch.organization, 'contoso');
  assert.strictEqual(launch.project, 'Web');

  const override = buildAdoMcpLaunchSpec({
    enabled: true,
    organization: 'contoso',
    project: 'Web',
    auth: 'pat',
    command: 'npx',
    args: ['-y', '@azure-devops/mcp', 'contoso'],
  });
  assert.strictEqual(override.command, 'npx');
  assert.deepStrictEqual(override.args, ['-y', '@azure-devops/mcp', 'contoso']);

  const parsed = parseMcpToolPayload({
    content: [{ type: 'text', text: JSON.stringify({ id: 42, name: 'Plan' }) }],
  });
  assert.strictEqual(parsed.id, 42);

  let threw = false;
  try {
    parseMcpToolPayload({
      isError: true,
      content: [{ type: 'text', text: 'Error creating test plan: boom' }],
    });
  } catch (err) {
    threw = true;
    assert.ok(String(err.message).includes('boom'));
  }
  assert.ok(threw, 'expected parseMcpToolPayload to throw on isError');

  console.log('test-ado-mcp-launcher: OK');
}

main();
