const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const allowedRoots = [
  path.join(root, 'src', 'integrations', 'browser_use'),
  path.join(root, 'packages', 'browser-use'),
];
const ignoredNames = new Set([
  '.git',
  '.venv',
  'venv',
  'node_modules',
  'dist',
  'runtime',
]);
const sourceExtensions = new Set(['.py', '.ts', '.tsx', '.js', '.mjs', '.cjs']);
const browserUseImport =
  /(?:from\s+browser_use(?:\.|\s+import)|import\s+browser_use(?:\.|\s|$)|require\(['"]browser_use)/;
const requiredRoots = ['src', 'packages', 'resources', 'tests', 'docs', 'scripts', 'runtime'];
const forbiddenLegacyRoots = [
  'cli',
  'core',
  'agents',
  'utils',
  'integrations',
  'framework',
  'config',
  'prompts',
  'assets',
  'reports',
  'artifacts',
  'healing-cache',
  'playwright-report',
  'test-results',
];

function isAllowed(filePath) {
  return allowedRoots.some((allowedRoot) => filePath.startsWith(`${allowedRoot}${path.sep}`));
}

function visit(directory, violations) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(fullPath, violations);
      continue;
    }
    if (!sourceExtensions.has(path.extname(entry.name)) || isAllowed(fullPath)) {
      continue;
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    if (browserUseImport.test(content)) {
      violations.push(path.relative(root, fullPath));
    }
  }
}

const violations = [];
visit(root, violations);

const hierarchyErrors = [];
for (const directory of requiredRoots) {
  if (!fs.existsSync(path.join(root, directory))) {
    hierarchyErrors.push(`missing required root: ${directory}`);
  }
}
for (const directory of forbiddenLegacyRoots) {
  if (fs.existsSync(path.join(root, directory))) {
    hierarchyErrors.push(`legacy root must be moved: ${directory}`);
  }
}

if (violations.length > 0) {
  console.error('Browser Use boundary violation. Import through src/integrations/browser_use:');
  for (const file of violations) {
    console.error(`  - ${file}`);
  }
  process.exit(1);
}

if (hierarchyErrors.length > 0) {
  console.error('Repository hierarchy violation:');
  for (const error of hierarchyErrors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log('Browser Use boundary and repository hierarchy are clean.');
