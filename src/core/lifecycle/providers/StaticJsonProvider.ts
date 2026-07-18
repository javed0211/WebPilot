import * as fs from 'fs';
import { resolveFixturePath } from '../FixtureManifestParser';
import type { FixtureStaticSeedSpec } from '../FixtureTypes';
import type { FixtureProvider, FixtureProviderContext, FixtureProviderResult } from './FixtureProvider';

export class StaticJsonProvider implements FixtureProvider {
  public readonly kind = 'static-json';

  public async apply(ctx: FixtureProviderContext): Promise<FixtureProviderResult> {
    const seed = ctx.manifest.seed as FixtureStaticSeedSpec | undefined;
    const pathRef = seed?.path || ctx.manifest.setup?.path;
    if (!pathRef) {
      throw new Error('static-json provider requires seed.path or setup.path');
    }

    const abs = resolveFixturePath(pathRef, ctx.run.projectRoot);
    if (!fs.existsSync(abs)) {
      throw new Error(`static-json seed file not found: ${abs}`);
    }

    const raw = JSON.parse(fs.readFileSync(abs, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`static-json seed must be a JSON object: ${abs}`);
    }

    const variables = raw as Record<string, unknown>;
    return { variables };
  }
}
