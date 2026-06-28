#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const {
  renderGithubActionsWorkflow,
  writeGithubActionsWorkflow,
} = require(path.join(root, 'dist/src/core/ci/CiWorkflow.js'));
const {
  ARTIFACT_MANIFEST_PATH,
  writeArtifactManifest,
} = require(path.join(root, 'dist/src/core/ci/ArtifactManifest.js'));

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

const workflow = renderGithubActionsWorkflow({
  provider: 'local-playwright',
  testPath: 'tests/web/smoke.txt',
  nodeVersion: '20',
});
assert(workflow.includes('npx webpilot ci doctor --provider local-playwright'), 'F07 workflow renders CI doctor step');
assert(workflow.includes('npx webpilot ci run tests/web/smoke.txt --provider local-playwright'), 'F07 workflow renders CI run step');
assert(workflow.includes('actions/upload-artifact@v4'), 'F07 workflow uploads runtime reports');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webpilot-ci-'));
const originalCwd = process.cwd();
process.chdir(tmp);
try {
  const first = writeGithubActionsWorkflow({ workflow: { provider: 'browser-use' } });
  assert(first.written, 'F07 ci init writes workflow');
  assert(fs.existsSync(path.join(tmp, '.github/workflows/webpilot.yml')), 'F07 workflow exists at stable path');

  const existing = fs.readFileSync(path.join(tmp, '.github/workflows/webpilot.yml'), 'utf8');
  fs.writeFileSync(path.join(tmp, '.github/workflows/webpilot.yml'), `${existing}\n# custom\n`, 'utf8');
  const second = writeGithubActionsWorkflow({ workflow: { provider: 'testmu' } });
  const afterSecond = fs.readFileSync(path.join(tmp, '.github/workflows/webpilot.yml'), 'utf8');
  assert(!second.written, 'F07 ci init does not overwrite without force');
  assert(afterSecond.includes('# custom'), 'F07 existing workflow content preserved');

  const forced = writeGithubActionsWorkflow({ force: true, workflow: { provider: 'testmu' } });
  const afterForce = fs.readFileSync(path.join(tmp, '.github/workflows/webpilot.yml'), 'utf8');
  assert(forced.written && afterForce.includes('--provider testmu'), 'F07 ci init --force overwrites workflow');
} finally {
  process.chdir(originalCwd);
}

const reportsRoot = path.join(root, 'runtime/reports');
const htmlDir = path.join(reportsRoot, 'html');
const junitDir = path.join(reportsRoot, 'junit');
const tracesDir = path.join(reportsRoot, 'traces');
const videosDir = path.join(reportsRoot, 'videos');
const screenshotsDir = path.join(reportsRoot, 'screenshots/feature07');
const summariesDir = path.join(reportsRoot, 'data/summaries');
for (const dir of [htmlDir, junitDir, tracesDir, videosDir, screenshotsDir, summariesDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
fs.writeFileSync(path.join(htmlDir, 'index.html'), '<html></html>', 'utf8');
fs.writeFileSync(path.join(junitDir, 'junit-results.xml'), '<testsuite />', 'utf8');
fs.writeFileSync(path.join(tracesDir, 'feature07_trace.zip'), 'zip', 'utf8');
fs.writeFileSync(path.join(videosDir, 'feature07.webm'), 'video', 'utf8');
fs.writeFileSync(path.join(screenshotsDir, 'step.png'), 'png', 'utf8');
fs.writeFileSync(
  path.join(summariesDir, 'feature07_summary.json'),
  JSON.stringify({
    test: 'feature07',
    testName: 'Feature 07',
    status: 'PASSED',
    timestamp: new Date().toISOString(),
    stepsExecuted: 1,
    summary: 'CI fixture',
  }),
  'utf8'
);

const manifestResult = writeArtifactManifest();
const manifest = manifestResult.manifest;
assert(manifestResult.path === ARTIFACT_MANIFEST_PATH, 'F07 manifest writes to stable path');
assert(manifest.htmlReports.some((p) => p.endsWith('runtime/reports/html/index.html')), 'F07 manifest includes HTML report');
assert(manifest.junit.some((p) => p.endsWith('junit-results.xml')), 'F07 manifest includes JUnit XML');
assert(manifest.traces.some((p) => p.endsWith('feature07_trace.zip')), 'F07 manifest includes trace files');
assert(manifest.videos.some((p) => p.endsWith('feature07.webm')), 'F07 manifest includes video files');
assert(manifest.screenshots.some((p) => p.endsWith('step.png')), 'F07 manifest includes screenshots');
assert(manifest.summaries.some((p) => p.endsWith('feature07_summary.json')), 'F07 manifest includes summaries');

const reportJson = spawnSync(process.execPath, ['dist/src/cli/index.js', 'report', '--json', '--test', 'feature07'], {
  cwd: root,
  encoding: 'utf8',
});
assert(reportJson.status === 0, 'F07 report --json exits 0');
try {
  const parsed = JSON.parse(reportJson.stdout);
  assert(parsed.report?.testCases?.[0]?.slug === 'feature07', 'F07 report --json emits suite report JSON');
  assert(parsed.artifactManifest?.summaries?.length >= 1, 'F07 report --json includes artifact manifest');
} catch (error) {
  fail('F07 report --json is parseable JSON', error.message);
}

const failed = results.filter((item) => !item.ok);
console.log(`\nFeature 07 checks: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
