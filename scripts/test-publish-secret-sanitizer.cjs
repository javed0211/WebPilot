#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CREDENTIAL_FIELDS, sanitizeFile } = require('./sanitize-publish-secrets.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webpilot-publish-security-'));
const fixturePath = path.join(root, 'llm.json');
const fixture = {};

for (const field of CREDENTIAL_FIELDS) {
  const [provider, key] = field.path;
  fixture[provider] ||= {};
  fixture[provider][key] = `inline-value-for-${provider}-${key}`;
}

try {
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

  const fixed = sanitizeFile(fixturePath, { mode: 'fix' });
  assert.strictEqual(fixed.changed.length, CREDENTIAL_FIELDS.length);

  const sanitized = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  for (const field of CREDENTIAL_FIELDS) {
    const [provider, key] = field.path;
    assert.strictEqual(sanitized[provider][key], field.placeholder);
  }

  const checked = sanitizeFile(fixturePath, { mode: 'check' });
  assert.deepStrictEqual(checked.changed, []);
  console.log(`Publish secret sanitizer: ${CREDENTIAL_FIELDS.length} credential fields protected.`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
