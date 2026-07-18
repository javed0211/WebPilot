import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RUNTIME_ROOT } from '../../ProjectPaths';
import type { FixtureTempDirSpec } from '../FixtureTypes';
import type { FixtureProvider, FixtureProviderContext, FixtureProviderResult } from './FixtureProvider';

export class TempDirProvider implements FixtureProvider {
  public readonly kind = 'temp-dir';

  public async apply(ctx: FixtureProviderContext): Promise<FixtureProviderResult> {
    const seed = ctx.manifest.seed as FixtureTempDirSpec | undefined;
    const prefix = seed?.prefix || ctx.run.scenarioId || 'webpilot';
    const base = path.join(RUNTIME_ROOT, 'fixtures', 'tmp');
    fs.mkdirSync(base, { recursive: true });

    const tempDir = fs.mkdtempSync(path.join(base, `${prefix}-`));
    // Also support OS temp as fallback marker in variables.
    const osHint = os.tmpdir();

    ctx.cleanup.push(`temp-dir:${tempDir}`, () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    return {
      tempDir,
      variables: {
        FIXTURE_TEMP_DIR: tempDir,
        WEBPILOT_FIXTURE_TEMP_DIR: tempDir,
        _osTmpHint: osHint,
      },
    };
  }
}
