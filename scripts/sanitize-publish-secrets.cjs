#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = path.resolve(__dirname, '..', 'resources', 'config', 'llm.json');

const CREDENTIAL_FIELDS = [
  { path: ['google', 'apiKey'], placeholder: '${GEMINI_API_KEY}' },
  { path: ['openai', 'apiKey'], placeholder: '${OPENAI_API_KEY}' },
  { path: ['anthropic', 'apiKey'], placeholder: '${ANTHROPIC_API_KEY}' },
  { path: ['azure', 'apiKey'], placeholder: '${AZURE_OPENAI_API_KEY}' },
  { path: ['aws', 'apiKey'], placeholder: '${AWS_ACCESS_KEY_ID}' },
  { path: ['aws', 'secretKey'], placeholder: '${AWS_SECRET_ACCESS_KEY}' },
  { path: ['gcp', 'apiKey'], placeholder: '${GCP_API_KEY}' },
];

function valueAt(root, parts) {
  let current = root;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function setValueAt(root, parts, value) {
  let current = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = current[parts[index]];
  }
  current[parts[parts.length - 1]] = value;
}

function sanitizeFile(filePath, options = {}) {
  const mode = options.mode || 'check';
  const absolutePath = path.resolve(filePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const config = JSON.parse(source);
  const changed = [];

  for (const field of CREDENTIAL_FIELDS) {
    const current = valueAt(config, field.path);
    if (current === undefined || current === field.placeholder) continue;
    setValueAt(config, field.path, field.placeholder);
    changed.push(field.path.join('.'));
  }

  if (changed.length > 0 && mode === 'fix') {
    const temporaryPath = `${absolutePath}.sanitizing-${process.pid}`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      mode: fs.statSync(absolutePath).mode,
    });
    fs.renameSync(temporaryPath, absolutePath);
  }

  return { changed, filePath: absolutePath };
}

function parseArguments(argv) {
  let mode = 'check';
  let filePath = DEFAULT_CONFIG;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') mode = 'check';
    else if (argument === '--fix') mode = 'fix';
    else if (argument === '--file') {
      filePath = argv[index + 1];
      index += 1;
      if (!filePath) throw new Error('--file requires a path');
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return { mode, filePath };
}

function runCli(argv = process.argv.slice(2)) {
  try {
    const options = parseArguments(argv);
    const result = sanitizeFile(options.filePath, options);
    const relativePath = path.relative(process.cwd(), result.filePath) || result.filePath;

    if (result.changed.length === 0) {
      console.log(`[publish-security] Credential placeholders verified in ${relativePath}.`);
      return 0;
    }

    const fields = result.changed.join(', ');
    if (options.mode === 'fix') {
      console.error(`[publish-security] Removed inline credential values from ${relativePath}: ${fields}`);
      console.error('[publish-security] Publishing was stopped. Review and commit the sanitized file, then retry.');
    } else {
      console.error(`[publish-security] Inline credential values found in ${relativePath}: ${fields}`);
      console.error('[publish-security] Run: npm run security:secrets:fix');
    }
    return 1;
  } catch (error) {
    console.error(`[publish-security] ${error.message}`);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = runCli();
}

module.exports = { CREDENTIAL_FIELDS, sanitizeFile };
