import * as fs from 'fs';
import * as path from 'path';

/**
 * Where generated TypeScript Playwright specs live.
 *
 * New projects (init >= 1.5) use `packages/test-framework/specs` so generated
 * output no longer shares the word "tests" with the natural-language scripts in
 * `tests/`. Projects created before the rename keep their existing
 * `packages/test-framework/tests` directory — presence of that directory wins,
 * so nothing moves under an upgraded CLI.
 */
export const LEGACY_TS_SPECS_DIR = 'packages/test-framework/tests';
export const DEFAULT_TS_SPECS_DIR = 'packages/test-framework/specs';

export function generatedSpecsDir(cwd = process.cwd()): string {
  if (fs.existsSync(path.join(cwd, LEGACY_TS_SPECS_DIR))) return LEGACY_TS_SPECS_DIR;
  return DEFAULT_TS_SPECS_DIR;
}

export function generatedSpecPath(slug: string, cwd = process.cwd()): string {
  return `${generatedSpecsDir(cwd)}/${slug}.spec.ts`;
}
