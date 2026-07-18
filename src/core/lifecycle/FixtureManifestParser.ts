import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { PROJECT_ROOT } from '../ProjectPaths';
import type { FixtureManifest, FixtureProviderKind } from './FixtureTypes';

const ALLOWED_PROVIDERS = new Set<FixtureProviderKind>([
  'static-json',
  'http-seed',
  'temp-dir',
  'playwright-storage-state',
]);

export class FixtureManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixtureManifestError';
  }
}

/**
 * Resolve a fixture path relative to the project root and ensure it stays inside the project.
 */
export function resolveFixturePath(fixtureRef: string, projectRoot: string = PROJECT_ROOT): string {
  const trimmed = fixtureRef.trim();
  if (!trimmed) {
    throw new FixtureManifestError('Fixture path is empty');
  }

  const abs = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.normalize(path.join(projectRoot, trimmed));

  const root = path.normalize(projectRoot);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new FixtureManifestError(
      `Fixture path escapes project root: ${fixtureRef} → ${abs}`
    );
  }
  return abs;
}

function assertProvider(value: unknown, label: string): FixtureProviderKind {
  if (typeof value !== 'string' || !ALLOWED_PROVIDERS.has(value as FixtureProviderKind)) {
    throw new FixtureManifestError(
      `${label} provider must be one of: ${[...ALLOWED_PROVIDERS].join(', ')}`
    );
  }
  return value as FixtureProviderKind;
}

export class FixtureManifestParser {
  public static parseFile(filePath: string, projectRoot: string = PROJECT_ROOT): FixtureManifest {
    const abs = resolveFixturePath(filePath, projectRoot);
    if (!fs.existsSync(abs)) {
      throw new FixtureManifestError(`Fixture manifest not found: ${abs}`);
    }
    const raw = fs.readFileSync(abs, 'utf8');
    return FixtureManifestParser.parseContent(raw, abs);
  }

  public static parseContent(content: string, sourceLabel = 'fixture'): FixtureManifest {
    let loaded: unknown;
    try {
      loaded = yaml.load(content);
    } catch (err) {
      throw new FixtureManifestError(
        `Invalid YAML in ${sourceLabel}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
      throw new FixtureManifestError(`${sourceLabel} must be a YAML/JSON object`);
    }

    const doc = loaded as Record<string, unknown>;
    if (doc.schemaVersion !== 1) {
      throw new FixtureManifestError(
        `${sourceLabel} requires schemaVersion: 1 (got ${String(doc.schemaVersion)})`
      );
    }

    const manifest: FixtureManifest = {
      schemaVersion: 1,
      name: typeof doc.name === 'string' ? doc.name : undefined,
    };

    if (doc.setup && typeof doc.setup === 'object') {
      const setup = doc.setup as Record<string, unknown>;
      manifest.setup = {
        provider: assertProvider(setup.provider, 'setup'),
        operation: typeof setup.operation === 'string' ? setup.operation : undefined,
        path: typeof setup.path === 'string' ? setup.path : undefined,
      };
    }

    if (doc.seed && typeof doc.seed === 'object') {
      const seed = doc.seed as Record<string, unknown>;
      const provider =
        typeof seed.provider === 'string'
          ? assertProvider(seed.provider, 'seed')
          : seed.path
            ? 'static-json'
            : undefined;

      if (provider === 'http-seed') {
        if (typeof seed.url !== 'string' || !seed.url.trim()) {
          throw new FixtureManifestError('http-seed requires url');
        }
        const cleanup =
          seed.cleanup && typeof seed.cleanup === 'object'
            ? (seed.cleanup as Record<string, unknown>)
            : undefined;
        manifest.seed = {
          provider: 'http-seed',
          method: typeof seed.method === 'string' ? seed.method : 'POST',
          url: seed.url,
          bodyPath: typeof seed.bodyPath === 'string' ? seed.bodyPath : undefined,
          body:
            seed.body && typeof seed.body === 'object' && !Array.isArray(seed.body)
              ? (seed.body as Record<string, unknown>)
              : undefined,
          headers:
            seed.headers && typeof seed.headers === 'object'
              ? (seed.headers as Record<string, string>)
              : undefined,
          cleanup: cleanup
            ? {
                method: typeof cleanup.method === 'string' ? cleanup.method : 'DELETE',
                urlTemplate: String(cleanup.urlTemplate || ''),
                idPath: typeof cleanup.idPath === 'string' ? cleanup.idPath : 'id',
              }
            : undefined,
        };
        if (manifest.seed.cleanup && !manifest.seed.cleanup.urlTemplate) {
          throw new FixtureManifestError('http-seed cleanup requires urlTemplate');
        }
      } else if (provider === 'temp-dir') {
        manifest.seed = {
          provider: 'temp-dir',
          prefix: typeof seed.prefix === 'string' ? seed.prefix : undefined,
        };
      } else {
        if (typeof seed.path !== 'string' || !seed.path.trim()) {
          throw new FixtureManifestError('static-json seed requires path');
        }
        manifest.seed = {
          provider: 'static-json',
          dataset: typeof seed.dataset === 'string' ? seed.dataset : undefined,
          path: seed.path,
        };
      }
    }

    if (doc.auth && typeof doc.auth === 'object') {
      const auth = doc.auth as Record<string, unknown>;
      if (auth.provider !== 'playwright-storage-state') {
        throw new FixtureManifestError('auth.provider must be playwright-storage-state');
      }
      if (typeof auth.profile !== 'string' || !auth.profile.trim()) {
        throw new FixtureManifestError('auth.profile is required');
      }
      manifest.auth = {
        provider: 'playwright-storage-state',
        profile: auth.profile,
        storageStatePath:
          typeof auth.storageStatePath === 'string' ? auth.storageStatePath : undefined,
        ttlMinutes: typeof auth.ttlMinutes === 'number' ? auth.ttlMinutes : undefined,
      };
    }

    if (doc.isolation && typeof doc.isolation === 'object') {
      const isolation = doc.isolation as Record<string, unknown>;
      const strategy = isolation.strategy;
      if (
        strategy !== 'per-run' &&
        strategy !== 'per-worker' &&
        strategy !== 'shared'
      ) {
        throw new FixtureManifestError('isolation.strategy must be per-run | per-worker | shared');
      }
      manifest.isolation = { strategy };
    }

    if (doc.teardown && typeof doc.teardown === 'object') {
      const teardown = doc.teardown as Record<string, unknown>;
      manifest.teardown = {
        provider:
          typeof teardown.provider === 'string'
            ? assertProvider(teardown.provider, 'teardown')
            : undefined,
        operation: typeof teardown.operation === 'string' ? teardown.operation : undefined,
        url: typeof teardown.url === 'string' ? teardown.url : undefined,
        method: typeof teardown.method === 'string' ? teardown.method : undefined,
      };
    }

    if (doc.failureCleanup && typeof doc.failureCleanup === 'object') {
      const fc = doc.failureCleanup as Record<string, unknown>;
      manifest.failureCleanup = { enabled: Boolean(fc.enabled) };
    }

    if (doc.redaction && typeof doc.redaction === 'object') {
      const redaction = doc.redaction as Record<string, unknown>;
      const fields = Array.isArray(redaction.fields)
        ? redaction.fields.filter((f): f is string => typeof f === 'string')
        : undefined;
      manifest.redaction = { fields };
    }

    return manifest;
  }
}
