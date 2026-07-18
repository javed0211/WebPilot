import * as fs from 'fs';
import { request as playwrightRequest } from 'playwright';
import { resolveFixturePath } from '../FixtureManifestParser';
import type { FixtureHttpSeedSpec } from '../FixtureTypes';
import {
  getNested,
  interpolateTemplate,
  type FixtureProvider,
  type FixtureProviderContext,
  type FixtureProviderResult,
} from './FixtureProvider';

function resolveUrl(url: string, variables: Record<string, unknown>): string {
  const interpolated = interpolateTemplate(url, variables);
  if (/^https?:\/\//i.test(interpolated)) return interpolated;
  const base = String(variables.apiBaseUrl || variables.baseUrl || '').replace(/\/$/, '');
  if (!base) return interpolated;
  return `${base}${interpolated.startsWith('/') ? '' : '/'}${interpolated}`;
}

export class HttpSeedProvider implements FixtureProvider {
  public readonly kind = 'http-seed';

  public async apply(ctx: FixtureProviderContext): Promise<FixtureProviderResult> {
    const seed = ctx.manifest.seed as FixtureHttpSeedSpec | undefined;
    if (!seed || seed.provider !== 'http-seed') {
      throw new Error('http-seed provider requires seed.provider: http-seed');
    }

    let body: unknown = seed.body;
    if (seed.bodyPath) {
      const abs = resolveFixturePath(seed.bodyPath, ctx.run.projectRoot);
      body = JSON.parse(fs.readFileSync(abs, 'utf8'));
    }

    const method = (seed.method || 'POST').toUpperCase();
    const url = resolveUrl(seed.url, ctx.variables);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(seed.headers || {}),
    };

    // Interpolate header templates (e.g. Bearer {{AUTH_TOKEN}})
    for (const [k, v] of Object.entries(headers)) {
      headers[k] = interpolateTemplate(v, ctx.variables);
    }

    const apiContext = await playwrightRequest.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: headers,
    });

    try {
      const response = await apiContext.fetch(url, {
        method,
        data: body !== undefined ? body : undefined,
      });
      const status = response.status();
      const text = await response.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        json = { raw: text };
      }

      if (status < 200 || status >= 300) {
        throw new Error(`http-seed ${method} ${url} failed with status ${status}: ${text.slice(0, 300)}`);
      }

      const idPath = seed.cleanup?.idPath || 'id';
      const seedId = getNested(json, idPath);
      const variables: Record<string, unknown> = {
        ...json,
        SEED_ID: seedId,
        FIXTURE_SEED_ID: seedId,
      };

      if (seed.cleanup?.urlTemplate) {
        const cleanupMethod = (seed.cleanup.method || 'DELETE').toUpperCase();
        const cleanupVars = { ...ctx.variables, ...variables, id: seedId };
        const cleanupUrl = resolveUrl(
          interpolateTemplate(seed.cleanup.urlTemplate, cleanupVars),
          cleanupVars
        );

        ctx.cleanup.push(`http-seed.cleanup:${cleanupUrl}`, async () => {
          const cleanupCtx = await playwrightRequest.newContext({
            ignoreHTTPSErrors: true,
            extraHTTPHeaders: headers,
          });
          try {
            const cleanupRes = await cleanupCtx.fetch(cleanupUrl, { method: cleanupMethod });
            if (cleanupRes.status() >= 400 && cleanupRes.status() !== 404) {
              throw new Error(
                `http-seed cleanup ${cleanupMethod} ${cleanupUrl} failed: ${cleanupRes.status()}`
              );
            }
          } finally {
            await cleanupCtx.dispose();
          }
        });
      }

      return {
        variables,
        seedId: seedId == null ? undefined : String(seedId),
      };
    } finally {
      await apiContext.dispose();
    }
  }
}
