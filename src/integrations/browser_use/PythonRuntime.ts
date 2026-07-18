import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { findCliInstallRoot, findProjectRoot } from '../../cli/ProjectContext';

const VENV_DIR = '.venv';
const REQUIREMENTS = 'requirements.txt';
const REQUIREMENTS_OVERRIDES = 'requirements-overrides.txt';

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

/**
 * Split a python launcher command into exe + args.
 * CRITICAL: must NOT split absolute paths on spaces — otherwise
 * `C:\Program Files\Python312\python.exe` becomes exe=`C:\Program` → ENOENT.
 */
export function splitPythonCommand(cmd: string): { exe: string; prefixArgs: string[] } {
  const trimmed = cmd.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) {
    return { exe: process.platform === 'win32' ? 'python' : 'python3', prefixArgs: [] };
  }

  // Windows Python launcher: "py", "py.exe", "py -3.12", "py -3.13 -V:3.13"
  const pyLauncher = /^(py(?:\.exe)?)(?:\s+(.+))?$/i.exec(trimmed);
  if (pyLauncher) {
    const rest = (pyLauncher[2] || '').trim();
    return {
      exe: pyLauncher[1],
      prefixArgs: rest ? rest.split(/\s+/) : [],
    };
  }

  // Path with separators or drive letter / .exe — treat as a single executable.
  const looksLikePath =
    trimmed.includes(path.sep) ||
    trimmed.includes('/') ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    /\.exe$/i.test(trimmed);
  if (looksLikePath) {
    return { exe: trimmed, prefixArgs: [] };
  }

  // Bare command name (python3.12, python3, python)
  return { exe: trimmed, prefixArgs: [] };
}

function runPython(pythonPath: string, args: string[], opts: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: 'pipe' | 'inherit';
  encoding?: 'utf8';
}): string {
  const { exe, prefixArgs } = splitPythonCommand(pythonPath);
  const result = execFileSync(exe, [...prefixArgs, ...args], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: opts.stdio === 'inherit' ? 'inherit' : 'pipe',
    encoding: opts.encoding || 'utf8',
  });
  return typeof result === 'string' ? result : '';
}

/** Public helper for CLI/doctor — safe on Windows paths with spaces. */
export function execPythonSync(
  pythonPath: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: 'pipe' | 'inherit' } = {}
): string {
  return runPython(pythonPath, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: opts.stdio || 'pipe',
    encoding: 'utf8',
  });
}

function tryPythonCandidate(cmd: string): string | null {
  try {
    const out = runPython(cmd, ['-c', "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')"], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
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
      'WebPilot requires Python 3.11+.\n' +
      '  Install from https://www.python.org/downloads/ (or: winget install Python.Python.3.13)\n' +
      '  Or set WEBPILOT_PYTHON to your python.exe path\n' +
      'Then run: webpilot setup'
    );
  }
  return (
    'WebPilot requires Python 3.11+.\n' +
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
    runPython(pythonPath, ['-c', 'import browser_use; assert browser_use.__file__'], {
      cwd: projectRoot(),
      env: pythonEnv(),
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/** browser-use[video] extra — imageio + ffmpeg for MP4 recording. */
export function hasBrowserUseVideo(pythonPath: string): boolean {
  try {
    runPython(pythonPath, ['-c', 'import imageio; import imageio_ffmpeg'], {
      cwd: projectRoot(),
      env: pythonEnv(),
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function installBrowserUseRequirements(pythonPath: string): void {
  const cliRoot = installRoot();
  const reqPath = path.join(cliRoot, REQUIREMENTS);
  const overridePath = path.join(cliRoot, REQUIREMENTS_OVERRIDES);
  if (!fs.existsSync(reqPath)) {
    throw new Error(`Missing ${REQUIREMENTS} in the WebPilot CLI installation: ${cliRoot}`);
  }
  runPython(pythonPath, ['-m', 'pip', 'install', '-r', reqPath], {
    cwd: cliRoot,
    stdio: 'inherit',
  });
  if (fs.existsSync(overridePath)) {
    runPython(pythonPath, ['-m', 'pip', 'install', '-r', overridePath], {
      cwd: cliRoot,
      stdio: 'inherit',
    });
  }
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
        const ver = runPython(venvPy, ['-c', 'import sys; print(sys.version_info.minor)'], {
          encoding: 'utf8',
          stdio: 'pipe',
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

  runPython(venvPy, ['-m', 'pip', 'install', '-U', 'pip'], {
    cwd: root,
    stdio: 'inherit',
  });
  installBrowserUseRequirements(venvPy);
  return venvPy;
}

/**
 * Ensure the WebPilot browser agent is importable. Auto-creates .venv and installs deps unless
 * WEBPILOT_SKIP_PYTHON_SETUP=1.
 */
export function ensureBrowserUsePython(): string {
  let pythonPath = resolvePythonPath();

  if (hasBrowserUse(pythonPath)) {
    return pythonPath;
  }

  if (process.env.WEBPILOT_SKIP_PYTHON_SETUP === '1') {
    throw new Error(
      'WebPilot browser agent is not installed.\n' +
      '  Run: webpilot setup\n' +
      `  Or: python -m venv .venv && ${process.platform === 'win32' ? '.venv\\Scripts\\pip' : '.venv/bin/pip'} install -r requirements.txt\n` +
      '  Or set WEBPILOT_PYTHON to a Python that already has the WebPilot agent package.'
    );
  }

  pythonPath = setupPythonVenv();

  if (!hasBrowserUse(pythonPath)) {
    throw new Error(
      'Failed to install WebPilot\'s vendored agent source. Run manually:\n' +
      `  ${pythonPath} -m pip install -r "${path.join(installRoot(), REQUIREMENTS)}"`
    );
  }

  return pythonPath;
}
