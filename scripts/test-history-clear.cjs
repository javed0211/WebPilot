/**
 * History clear: specific slug and --all.
 * Run: npm run build && node scripts/test-history-clear.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const {
  clearAllHistory,
  clearHistoryForSlug,
  listExecutionHistorySlugs,
  normalizeHistorySlug,
} = require(path.join(root, 'dist/src/core/HistoryClear.js'));
const { REPORTS_EXECUTION_HISTORY_DIR } = require(path.join(root, 'dist/src/core/ReportPaths.js'));

function writeHist(slug, ok) {
  fs.mkdirSync(REPORTS_EXECUTION_HISTORY_DIR, { recursive: true });
  const file = path.join(REPORTS_EXECUTION_HISTORY_DIR, `${slug}_execution_history.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({
      testName: slug,
      isSuccessful: ok,
      actHistory: [{ index: 1, action: 'navigate', url: 'https://example.com/', description: 'n' }],
    }),
    'utf8'
  );
  return file;
}

function main() {
  assert.strictEqual(normalizeHistorySlug('tests/web/Digital.txt'), 'Digital');
  assert.strictEqual(normalizeHistorySlug('Digital'), 'Digital');

  const a = `clr_a_${Date.now()}`;
  const b = `clr_b_${Date.now()}`;
  const fa = writeHist(a, false);
  const fb = writeHist(b, true);

  assert.ok(listExecutionHistorySlugs().includes(a));
  assert.ok(listExecutionHistorySlugs().includes(b));

  const one = clearHistoryForSlug(a);
  assert.ok(one.removed.some((p) => p.endsWith(`${a}_execution_history.json`)));
  assert.ok(!fs.existsSync(fa));
  assert.ok(fs.existsSync(fb));

  const all = clearAllHistory();
  assert.ok(all.removed.length >= 1);
  assert.ok(!fs.existsSync(fb));

  console.log('OK history-clear tests passed');
}

main();
