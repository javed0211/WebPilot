/**
 * Windows Program Files python paths must not be space-split.
 * Run: npm run build && node scripts/test-python-path-split.cjs
 */
const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const { splitPythonCommand } = require(path.join(root, 'dist/src/integrations/browser_use/PythonRuntime.js'));

function main() {
  const programFiles = splitPythonCommand(
    String.raw`C:\Program Files\Python312\python.exe`
  );
  assert.strictEqual(programFiles.exe, String.raw`C:\Program Files\Python312\python.exe`);
  assert.deepStrictEqual(programFiles.prefixArgs, []);

  const quoted = splitPythonCommand(
    String.raw`"C:\Program Files\Python312\python.exe"`
  );
  assert.strictEqual(quoted.exe, String.raw`C:\Program Files\Python312\python.exe`);

  const forward = splitPythonCommand('C:/Program Files/Python312/python.exe');
  assert.strictEqual(forward.exe, 'C:/Program Files/Python312/python.exe');
  assert.deepStrictEqual(forward.prefixArgs, []);

  const pyLauncher = splitPythonCommand('py -3.12');
  assert.strictEqual(pyLauncher.exe, 'py');
  assert.deepStrictEqual(pyLauncher.prefixArgs, ['-3.12']);

  const bare = splitPythonCommand('python3.12');
  assert.strictEqual(bare.exe, 'python3.12');
  assert.deepStrictEqual(bare.prefixArgs, []);

  console.log('OK python-path-split tests passed');
}

main();
