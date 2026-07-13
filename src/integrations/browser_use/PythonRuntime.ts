import * as fs from 'fs';
import * as path from 'path';
import { execSync, execFileSync } from 'child_process';
import { findCliInstallRoot, findProjectRoot } from '../../cli/ProjectContext';

const VENV_DIR = '.venv';
const REQUIREMENTS = 'requirements.txt';

/** Unix and Windows launcher names, newest first. 3.11+ is required; 3.12 is not. */
const SYSTEM_PYTHON_CANDIDATES = [
  'python3.13',
  'python3.12',
  'python3.11',
  'python3',
  'python',
  ...(process.platform === 'win32'
    ? ['py -3.13', 'py -3.12', 'py -3.11', 'py']
    : []),
];

function isPython311Plus(major: number, minor: number): boolean {
  return major > 3 || (major === 3 && minor >= 11);
}

function splitPythonCommand(cmd: string): { exe: string; prefixArgs: string[] } {
  const parts = cmd.trim().split(/\s+/);
  return { exe: parts[0], prefixArgs: parts.slice(1) };
}

function tryPythonCandidate(cmd: string): string | null {
  try {
    const { exe, prefixArgs } = splitPythonCommand(cmd);
    const out = execFileSync(
      exe,
      [...prefixArgs, '-c', "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')"],
      { encoding: 'utf8', stdio: 'pipe' }
    ).trim();
    const [major, minor] = out.split('.').map(Number);
    if (isPython311Plus(major, minor)) {
      return cmd;
    }
  } catch {
    /* try next */
  }
  return null;
}

function pythonSetupHint(): string {
  if (process.platform === 'win32') {
    return (
      'browser-use requires Python 3.11+.\n' +
      '  Install from https://www.python.org/downloads/ (or: winget install Python.Python.3.13)\n' +
      '  Or set WEBPILOT_PYTHON to your python.exe path\n' +
      'Then run: webpilot setup'
    );
  }
  return (
    'browser-use requires Python 3.11+.\n' +
    '  Install: brew install python@3.12  (macOS) or your distro python3 package\n' +
    '  Or set WEBPILOT_PYTHON=/path/to/python3\n' +
    'Then run: webpilot setup'
  );
}

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
  return process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

function pythonEnv() {
  return {
    ...process.env,
    WEBPILOT_PROJECT_ROOT: projectRoot(),
    WEBPILOT_INSTALL_ROOT: installRoot(),
    PYTHONPATH: [
      path.join(installRoot(), 'packages', 'browser-use'),
      path.join(installRoot(), 'src'),
    ].join(path.delimiter),
  };
}

export function hasBrowserUse(pythonPath: string): boolean {
  try {
    execSync(`"${pythonPath}" -c "import browser_use; assert browser_use.__file__"`, {
      stdio: 'pipe',
      cwd: projectRoot(),
      env: pythonEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

/** browser-use[video] extra — imageio + ffmpeg for MP4 recording. */
export function hasBrowserUseVideo(pythonPath: string): boolean {
  try {
    execSync(`"${pythonPath}" -c "import imageio; import imageio_ffmpeg"`, {
      stdio: 'pipe',
      cwd: projectRoot(),
      env: pythonEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

function installBrowserUseRequirements(pythonPath: string): void {
  const cliRoot = installRoot();
  const reqPath = path.join(cliRoot, REQUIREMENTS);
  if (!fs.existsSync(reqPath)) {
    throw new Error(`Missing ${REQUIREMENTS} in the WebPilot CLI installation: ${cliRoot}`);
  }
  execSync(`"${pythonPath}" -m pip install -r "${reqPath}"`, {
    stdio: 'inherit',
    cwd: cliRoot,
  });
}

export function findCompatibleSystemPython(): string | null {
  if (process.env.WEBPILOT_PYTHON) {
    return process.env.WEBPILOT_PYTHON;
  }
  for (const cmd of SYSTEM_PYTHON_CANDIDATES) {
    const found = tryPythonCandidate(cmd);
    if (found) {
      return found;
    }
  }
  return null;
}

function pickSystemPython(): string {
  const found = findCompatibleSystemPython();
  if (found) {
    return found;
  }
  throw new Error(pythonSetupHint());
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
    const { exe, prefixArgs } = splitPythonCommand(py);
    execFileSync(exe, [...prefixArgs, '-m', 'venv', path.join(root, VENV_DIR)], {
      stdio: 'inherit',
      cwd: root,
    });
  }

  const cliRoot = installRoot();
  const reqPath = path.join(cliRoot, REQUIREMENTS);
  if (!fs.existsSync(reqPath)) {
    throw new Error(`Missing ${REQUIREMENTS} in the WebPilot CLI installation: ${cliRoot}`);
  }

  execSync(`"${venvPy}" -m pip install -U pip`, { stdio: 'inherit', cwd: root });
  installBrowserUseRequirements(venvPy);
  return venvPy;
}

/**
 * Ensure browser-use is importable. Auto-creates .venv and installs deps unless
 * WEBPILOT_SKIP_PYTHON_SETUP=1.
 */
export function ensureBrowserUsePython(): string {
  let pythonPath = resolvePythonPath();

  if (hasBrowserUse(pythonPath)) {
    if (!hasBrowserUseVideo(pythonPath) && process.env.WEBPILOT_SKIP_PYTHON_SETUP !== '1') {
      console.log('[WebPilot] Installing browser-use[video] optional dependencies for MP4 recording...');
      installBrowserUseRequirements(pythonPath);
    }
    return pythonPath;
  }

  if (process.env.WEBPILOT_SKIP_PYTHON_SETUP === '1') {
    throw new Error(
      'Python package "browser_use" is not installed.\n' +
      '  Run: webpilot setup\n' +
      `  Or: python -m venv .venv && ${process.platform === 'win32' ? '.venv\\Scripts\\pip' : '.venv/bin/pip'} install -r requirements.txt\n` +
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
