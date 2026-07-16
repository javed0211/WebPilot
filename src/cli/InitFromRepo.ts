import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function isDirectoryEmpty(dir: string): boolean {
  if (!fs.existsSync(dir)) return true;
  return fs.readdirSync(dir).filter((name) => name !== '.DS_Store').length === 0;
}

function repoNameFromUrl(url: string): string {
  const cleaned = url.replace(/\/$/, '').replace(/\.git$/i, '');
  const parts = cleaned.split(/[/:]/);
  return parts[parts.length - 1] || 'cloned-repo';
}

export interface PrepareRepoResult {
  projectRoot: string;
  source: 'clone' | 'path' | 'none';
  detail: string;
}

/**
 * Prepare a project directory from an existing Git repo (clone) or local path.
 * Used by `webpilot init --clone` / `--from-path` so CodegenAgent can index
 * that repo's page objects into the knowledge graph.
 */
export function prepareProjectFromExistingRepo(options: {
  directory: string;
  cloneUrl?: string;
  fromPath?: string;
  branch?: string;
}): PrepareRepoResult {
  const projectRoot = path.resolve(process.cwd(), options.directory);

  if (options.cloneUrl && options.fromPath) {
    throw new Error('Use either --clone <url> or --from-path <dir>, not both.');
  }

  if (options.fromPath) {
    const source = path.resolve(process.cwd(), options.fromPath);
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
      throw new Error(`--from-path is not a directory: ${source}`);
    }
    if (path.resolve(source) === path.resolve(projectRoot)) {
      return {
        projectRoot,
        source: 'path',
        detail: `Using existing repo at ${projectRoot} as the WebPilot project root`,
      };
    }
    if (!isDirectoryEmpty(projectRoot) && path.resolve(projectRoot) !== path.resolve(source)) {
      // Copy/link: for different destinations, clone-style copy via git isn't needed —
      // require destination empty then copy tree (excluding heavy dirs).
      throw new Error(
        `Destination ${projectRoot} is not empty. Pass the existing repo as [directory], e.g.\n` +
          `  webpilot init "${source}" --from-path "${source}"\n` +
          `or clone into an empty folder with --clone.`
      );
    }
    if (isDirectoryEmpty(projectRoot) && path.resolve(projectRoot) !== path.resolve(source)) {
      fs.cpSync(source, projectRoot, {
        recursive: true,
        filter: (src) => {
          const base = path.basename(src);
          return !['node_modules', '.venv', 'dist', 'runtime', 'test-results'].includes(base);
        },
      });
      return {
        projectRoot,
        source: 'path',
        detail: `Copied existing framework from ${source} → ${projectRoot}`,
      };
    }
    return {
      projectRoot: source,
      source: 'path',
      detail: `Using existing repo at ${source}`,
    };
  }

  if (options.cloneUrl) {
    const dest =
      options.directory === '.' || options.directory === './'
        ? path.resolve(process.cwd(), repoNameFromUrl(options.cloneUrl))
        : projectRoot;

    if (!isDirectoryEmpty(dest)) {
      if (fs.existsSync(path.join(dest, '.git'))) {
        return {
          projectRoot: dest,
          source: 'clone',
          detail: `Destination already has a git repo at ${dest} — skipping clone, overlaying WebPilot`,
        };
      }
      throw new Error(
        `Cannot clone into non-empty directory: ${dest}\n` +
          'Pick an empty folder or omit [directory] to use the repo name.'
      );
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const args = ['clone', '--depth', '1'];
    if (options.branch) {
      args.push('--branch', options.branch);
    }
    args.push(options.cloneUrl, dest);
    execFileSync('git', args, { stdio: 'inherit' });
    return {
      projectRoot: dest,
      source: 'clone',
      detail: `Cloned ${options.cloneUrl} → ${dest}`,
    };
  }

  return {
    projectRoot,
    source: 'none',
    detail: 'Scaffolding a new WebPilot project',
  };
}
