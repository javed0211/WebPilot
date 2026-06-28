import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { findCliInstallRoot, findProjectRoot } from '../../cli/ProjectContext';

const VENV_DIR = '.venv';
const REQUIREMENTS = 'requirements.txt';

function projectRoot(): string {
  return path.resolve(process.env.WEBPILOT_PROJECT_ROOT || findProjectRoot());
}

function installRoot(): string {
  return path.resolve(process.env.WEBPILOT_INSTALL_ROOT || findCliInstallRoot());
}

function venvPython(root: string): string {
  return process.platform === 'win32'
    ? path.join(root, VENV_DIR, 'Scripts', 'python.exe')
    : path.join(root, VENV_DIR, 'bin', 'python3');
}

/** Prefer WEBPILOT_PYTHON → project .venv → python3 on PATH. */
export function resolvePythonPath(): string {
  const root = projectRoot();
  if (process.env.WEBPILOT_PYTHON) {
    return process.env.WEBPILOT_PYTHON;
  }
  const venvPy = venvPython(root);
  if (fs.existsSync(venvPy)) {
    return venvPy;
  }
  return process.env.PYTHON || 'python3';
}

export function hasBrowserUse(pythonPath: string): boolean {
  try {
    execSync(`"${pythonPath}" -c "import browser_use; assert browser_use.__file__"`, {
      stdio: 'pipe',
      cwd: projectRoot(),
      env: {
        ...process.env,
        WEBPILOT_PROJECT_ROOT: projectRoot(),
        WEBPILOT_INSTALL_ROOT: installRoot(),
        PYTHONPATH: [
          path.join(installRoot(), 'packages', 'browser-use'),
          path.join(installRoot(), 'src'),
        ].join(path.delimiter),
      }
    });
    return true;
  } catch {
    return false;
  }
}

function pickSystemPython(): string {
  if (process.env.WEBPILOT_PYTHON) {
    return process.env.WEBPILOT_PYTHON;
  }
  for (const cmd of ['python3.12', 'python3.11', 'python3']) {
    try {
      const out = execSync(`"${cmd}" -c "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')"`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      const [major, minor] = out.split('.').map(Number);
      if (major > 3 || (major === 3 && minor >= 11)) {
        return cmd;
      }
    } catch {
      /* try next */
    }
  }
  throw new Error(
    'browser-use requires Python 3.11+. Install with: brew install python@3.12\n' +
      'Then run: webpilot setup'
  );
}

/** Create .venv (if needed) and install the editable vendored Browser Use source. */
export function setupPythonVenv(systemPython?: string): string {
  const root = projectRoot();
  const venvPy = venvPython(root);
  const py = systemPython || pickSystemPython();

  const needsRecreate =
    fs.existsSync(venvPy) &&
    !hasBrowserUse(venvPy) &&
    (() => {
      try {
        const ver = execSync(`"${venvPy}" -c "import sys; print(sys.version_info.minor)"`, {
          encoding: 'utf8'
        }).trim();
        return Number(ver) < 11;
      } catch {
        return true;
      }
    })();

  if (!fs.existsSync(venvPy) || needsRecreate) {
    if (fs.existsSync(path.join(root, VENV_DIR))) {
      fs.rmSync(path.join(root, VENV_DIR), { recursive: true, force: true });
    }
    execSync(`"${py}" -m venv "${path.join(root, VENV_DIR)}"`, {
      stdio: 'inherit',
      cwd: root
    });
  }

  const cliRoot = installRoot();
  const reqPath = path.join(cliRoot, REQUIREMENTS);
  if (!fs.existsSync(reqPath)) {
    throw new Error(`Missing ${REQUIREMENTS} in the WebPilot CLI installation: ${cliRoot}`);
  }

  execSync(`"${venvPy}" -m pip install -U pip`, { stdio: 'inherit', cwd: root });
  execSync(`"${venvPy}" -m pip install -r "${reqPath}"`, {
    stdio: 'inherit',
    cwd: cliRoot,
  });
  return venvPy;
}

/**
 * Ensure browser-use is importable. Auto-creates .venv and installs deps unless
 * WEBPILOT_SKIP_PYTHON_SETUP=1.
 */
export function ensureBrowserUsePython(): string {
  let pythonPath = resolvePythonPath();

  if (hasBrowserUse(pythonPath)) {
    return pythonPath;
  }

  if (process.env.WEBPILOT_SKIP_PYTHON_SETUP === '1') {
    throw new Error(
      'Python package "browser_use" is not installed.\n' +
      '  Run: webpilot setup\n' +
      '  Or: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt\n' +
      '  Or set WEBPILOT_PYTHON to a Python that already has browser-use.'
    );
  }

  pythonPath = setupPythonVenv();

  if (!hasBrowserUse(pythonPath)) {
    throw new Error(
      'Failed to install WebPilot\'s vendored browser-use source. Run manually:\n' +
      `  ${pythonPath} -m pip install -r "${path.join(installRoot(), REQUIREMENTS)}"`
    );
  }

  return pythonPath;
}
