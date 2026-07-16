/**
 * History reuse must never treat failed discovery as reusable.
 * Run: npm run test:history-reuse
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const { decideHistoryReuse } = require(path.join(root, 'dist/src/core/codegen/HistoryReuse.js'));
const { REPORTS_EXECUTION_HISTORY_DIR } = require(path.join(root, 'dist/src/core/ReportPaths.js'));

function withEnv(overrides, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(overrides)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function writeCase(slug, doc) {
  fs.mkdirSync(REPORTS_EXECUTION_HISTORY_DIR, { recursive: true });
  const historyPath = path.join(REPORTS_EXECUTION_HISTORY_DIR, `${slug}_execution_history.json`);
  const testFile = path.join(os.tmpdir(), `webpilot-history-reuse-${slug}.txt`);
  fs.writeFileSync(testFile, 'Navigate to https://example.com\n', 'utf8');
  fs.writeFileSync(historyPath, JSON.stringify(doc), 'utf8');
  // Ensure history is newer than test file so mtime gate does not force rediscovery.
  const now = Date.now() / 1000;
  fs.utimesSync(historyPath, now, now);
  fs.utimesSync(testFile, now - 10, now - 10);
  return { historyPath, testFile };
}

function cleanup(paths) {
  for (const p of paths) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

function testRejectsFailedDoneTrue() {
  const slug = `hist_fail_${Date.now()}`;
  const { historyPath, testFile } = writeCase(slug, {
    testName: slug,
    isSuccessful: false,
    isDone: true,
    failure: 'Navigation failed: net::ERR_CONNECTION_CLOSED',
    actHistory: [
      {
        index: 1,
        action: 'navigate',
        url: 'https://example.com/',
        description: 'navigate',
      },
    ],
  });
  try {
    withEnv({ WEBPILOT_CODEGEN: '1', WEBPILOT_FORCE_DISCOVERY: undefined, WEBPILOT_REUSE_HISTORY: undefined }, () => {
      const decision = decideHistoryReuse(testFile, slug);
      assert.strictEqual(decision.reuse, false, 'must not reuse failed history when isDone=true');
      assert.match(decision.reason, /not successful/i);
    });
  } finally {
    cleanup([historyPath, testFile]);
  }
}

function testRejectsMissingSuccessFlag() {
  const slug = `hist_nosuccess_${Date.now()}`;
  const { historyPath, testFile } = writeCase(slug, {
    testName: slug,
    isDone: true,
    actHistory: [{ index: 1, action: 'navigate', url: 'https://example.com/', description: 'n' }],
  });
  try {
    withEnv({ WEBPILOT_CODEGEN: '1' }, () => {
      const decision = decideHistoryReuse(testFile, slug);
      assert.strictEqual(decision.reuse, false);
      assert.match(decision.reason, /not successful/i);
    });
  } finally {
    cleanup([historyPath, testFile]);
  }
}

function testRejectsFailureMarkersEvenIfSuccessfulFlagTrue() {
  const slug = `hist_markers_${Date.now()}`;
  const { historyPath, testFile } = writeCase(slug, {
    testName: slug,
    isSuccessful: true,
    isDone: true,
    failure: 'Native browser-use agent did not complete the scenario successfully',
    actHistory: [{ index: 1, action: 'navigate', url: 'https://example.com/', description: 'n' }],
  });
  try {
    withEnv({ WEBPILOT_CODEGEN: '1' }, () => {
      const decision = decideHistoryReuse(testFile, slug);
      assert.strictEqual(decision.reuse, false);
      assert.match(decision.reason, /not successful/i);
    });
  } finally {
    cleanup([historyPath, testFile]);
  }
}

function testCodegenSkippedForFailedHistory() {
  const { runPostExecutionCodegen } = require(path.join(
    root,
    'dist/src/core/codegen/PostExecutionCodegen.js'
  ));
  const slug = `codegen_skip_${Date.now()}`;
  const { historyPath, testFile } = writeCase(slug, {
    testName: slug,
    isSuccessful: false,
    isDone: true,
    failure: 'Navigation failed',
    actHistory: [{ index: 1, action: 'navigate', url: 'https://example.com/', description: 'n' }],
  });
  return (async () => {
    try {
      const result = await runPostExecutionCodegen({
        testName: slug,
        testFilePath: testFile,
        executionHistory: [{ action: 'navigate', url: 'https://example.com/', description: 'n' }],
        llmClient: {},
        architecture: 'pom',
        validate: false,
      });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.files.length, 0);
      assert.match(result.summary, /skipped/i);
      assert.match(result.summary, /not successful/i);
    } finally {
      cleanup([historyPath, testFile]);
    }
  })();
}

function testAllowsTrulySuccessfulHistory() {
  const slug = `hist_ok_${Date.now()}`;
  const { historyPath, testFile } = writeCase(slug, {
    testName: slug,
    isSuccessful: true,
    isDone: true,
    actHistory: [
      { index: 1, action: 'navigate', url: 'https://example.com/', description: 'n' },
      { index: 2, action: 'click', selector: '#go', description: 'click' },
    ],
  });
  try {
    withEnv({ WEBPILOT_CODEGEN: '1' }, () => {
      const decision = decideHistoryReuse(testFile, slug);
      assert.strictEqual(decision.reuse, true, decision.reason);
      assert.ok(decision.fingerprint);
    });
  } finally {
    cleanup([historyPath, testFile]);
  }
}

async function main() {
  testRejectsFailedDoneTrue();
  testRejectsMissingSuccessFlag();
  testRejectsFailureMarkersEvenIfSuccessfulFlagTrue();
  testAllowsTrulySuccessfulHistory();
  await testCodegenSkippedForFailedHistory();
  console.log('OK history-reuse tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
