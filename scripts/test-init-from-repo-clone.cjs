/**
 * Smoke: public HTTPS clone via InitFromRepo (no credentials required).
 * Run: npm run build && node scripts/test-init-from-repo-clone.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const { prepareProjectFromExistingRepo } = require(path.join(root, 'dist/src/cli/InitFromRepo.js'));

function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'webpilot-init-clone-'));
  const prev = process.cwd();
  try {
    process.chdir(work);
    const result = prepareProjectFromExistingRepo({
      directory: '.',
      cloneUrl: 'https://github.com/octocat/Hello-World.git',
      branch: 'master',
    });
    assert.strictEqual(result.source, 'clone');
    assert.ok(fs.existsSync(path.join(result.projectRoot, '.git')));
    assert.ok(fs.existsSync(path.join(result.projectRoot, 'README')));
    console.log('OK init-from-repo public clone smoke passed');
  } finally {
    process.chdir(prev);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main();
