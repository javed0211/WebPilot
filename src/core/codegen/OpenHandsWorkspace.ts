import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../ConfigManager';
import { generatedSpecsDir } from './GeneratedPaths';

export interface OpenHandsWorkspaceInfo {
  /** Absolute path OpenHands may edit. */
  workspaceAbs: string;
  /** Project-relative workspace path (posix). */
  workspaceRel: string;
  /** Spec path relative to the WebPilot project root (for Playwright validate/replay). */
  projectSpecPath: string;
  /** Spec path relative to the OpenHands workspace root. */
  workspaceSpecPath: string;
  /** Playwright config path relative to the project root (when workspace is inside project). */
  playwrightConfigPath: string;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function resolveConfiguredWorkspace(cwd: string): string {
  const env = String(process.env.WEBPILOT_OPENHANDS_WORKSPACE || '').trim();
  if (env) return env;

  const config = ConfigManager.getInstance();
  const openhands = String(config.get('framework.openhands.workspace', '') || '').trim();
  if (openhands && openhands !== '.') return openhands;

  const generated = String(config.get('framework.generatedCodePath', './packages/test-framework') || '')
    .trim()
    .replace(/\/$/, '');
  if (generated) return generated;

  return './packages/test-framework';
}

/**
 * Resolve the OpenHands codegen workspace.
 * Discovery stays in WebPilot runtime; codegen edits only this folder.
 */
export function resolveOpenHandsWorkspace(slug: string, cwd = process.cwd()): OpenHandsWorkspaceInfo {
  const configured = resolveConfiguredWorkspace(cwd);
  const workspaceAbs = path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(cwd, configured);
  fs.mkdirSync(workspaceAbs, { recursive: true });

  const workspaceRel = toPosix(path.relative(cwd, workspaceAbs) || '.');
  const specsDirName = (() => {
    // Prefer existing tests/ under the workspace (legacy), else specs/, else tests/.
    if (fs.existsSync(path.join(workspaceAbs, 'tests'))) return 'tests';
    if (fs.existsSync(path.join(workspaceAbs, 'specs'))) return 'specs';
    // If workspace is project root, fall back to generatedSpecsDir semantics.
    if (workspaceAbs === path.resolve(cwd)) {
      const dir = generatedSpecsDir(cwd);
      if (dir.startsWith('packages/test-framework/')) {
        return dir.replace(/^packages\/test-framework\//, '');
      }
    }
    return 'tests';
  })();

  const workspaceSpecPath = `${specsDirName}/${slug}.spec.ts`;
  const projectSpecPath =
    workspaceRel === '.'
      ? workspaceSpecPath
      : toPosix(path.join(workspaceRel, workspaceSpecPath));

  const playwrightConfigPath = fs.existsSync(path.join(workspaceAbs, 'playwright.config.ts'))
    ? toPosix(path.join(workspaceRel === '.' ? '' : workspaceRel, 'playwright.config.ts')).replace(
        /^\//,
        ''
      )
    : 'packages/test-framework/playwright.config.ts';

  return {
    workspaceAbs,
    workspaceRel,
    projectSpecPath,
    workspaceSpecPath,
    playwrightConfigPath: playwrightConfigPath || 'packages/test-framework/playwright.config.ts',
  };
}
