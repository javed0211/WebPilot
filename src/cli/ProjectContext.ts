import * as fs from 'fs';
import * as path from 'path';

const PROJECT_CONFIG = path.join('resources', 'config', 'webpilot.yaml');

function findUp(start: string, predicate: (directory: string) => boolean): string | null {
  let current = path.resolve(start);
  while (true) {
    if (predicate(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function findProjectRoot(start = process.cwd()): string {
  const explicit = process.env.WEBPILOT_PROJECT_ROOT;
  if (explicit) {
    const root = path.resolve(explicit);
    if (!fs.existsSync(path.join(root, PROJECT_CONFIG))) {
      throw new Error(`WEBPILOT_PROJECT_ROOT is not a WebPilot project: ${root}`);
    }
    return root;
  }

  const root = findUp(start, (directory) => fs.existsSync(path.join(directory, PROJECT_CONFIG)));
  if (!root) {
    throw new Error(
      `No WebPilot project found from ${start} (expected ${PROJECT_CONFIG}).\n` +
        'Scaffold one first with `npx webpilot init`, then run this command inside the project.\n' +
        'Alternatively set WEBPILOT_PROJECT_ROOT to an existing WebPilot project.'
    );
  }
  return root;
}

export function findCliInstallRoot(start = __dirname): string {
  const root = findUp(start, (directory) => {
    const packagePath = path.join(directory, 'package.json');
    if (!fs.existsSync(packagePath)) return false;
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
        name?: string;
        bin?: string | Record<string, string>;
      };
      const name = pkg.name ?? '';
      // Match by name (plain or any scope ending in /webpilot) OR by the
      // `webpilot` bin entry, so a future scope/rename never breaks discovery.
      const nameMatches = name === 'webpilot' || /(^|\/)webpilot$/.test(name);
      const binMatches =
        typeof pkg.bin === 'object' && pkg.bin !== null
          ? Object.prototype.hasOwnProperty.call(pkg.bin, 'webpilot')
          : false;
      return nameMatches || binMatches;
    } catch {
      return false;
    }
  });
  if (!root) {
    throw new Error(
      `Unable to locate the WebPilot CLI installation from ${start}. ` +
        'Reinstall the package (npm install @qubiqlabs/webpilot) and try again.'
    );
  }
  return root;
}

export function initializeProjectContext(
  required = true
): { projectRoot: string; installRoot: string } {
  let projectRoot: string;
  try {
    projectRoot = findProjectRoot();
  } catch (error) {
    if (required) throw error;
    projectRoot = process.cwd();
  }
  const installRoot = findCliInstallRoot();
  process.env.WEBPILOT_PROJECT_ROOT = projectRoot;
  process.env.WEBPILOT_INSTALL_ROOT = installRoot;
  process.chdir(projectRoot);
  return { projectRoot, installRoot };
}
