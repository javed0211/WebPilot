import * as fs from 'fs';
import * as path from 'path';
import { RUNTIME_ROOT } from '../../ProjectPaths';
import type { FixtureAuthSpec } from '../FixtureTypes';
import type { FixtureProvider, FixtureProviderContext, FixtureProviderResult } from './FixtureProvider';

function defaultStorageStatePath(profile: string, isolationKey: string): string {
  const safeProfile = profile.replace(/[^A-Za-z0-9._-]/g, '_');
  const safeIso = isolationKey.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  return path.join(RUNTIME_ROOT, 'auth-state', safeProfile, `${safeIso}.json`);
}

function isExpired(filePath: string, ttlMinutes?: number): boolean {
  if (!ttlMinutes || ttlMinutes <= 0) return false;
  try {
    const ageMs = Date.now() - fs.statSync(filePath).mtimeMs;
    return ageMs > ttlMinutes * 60_000;
  } catch {
    return true;
  }
}

/**
 * Applies an existing Playwright storage-state file.
 * Capture/login is out of scope for V1 — callers must place a valid state file
 * at the configured path (or the default runtime/auth-state location).
 */
export class PlaywrightStorageStateProvider implements FixtureProvider {
  public readonly kind = 'playwright-storage-state';

  public async apply(ctx: FixtureProviderContext): Promise<FixtureProviderResult> {
    const auth = ctx.manifest.auth as FixtureAuthSpec | undefined;
    if (!auth || auth.provider !== 'playwright-storage-state') {
      throw new Error('playwright-storage-state requires auth.provider');
    }

    const configured = auth.storageStatePath
      ? path.isAbsolute(auth.storageStatePath)
        ? auth.storageStatePath
        : path.join(ctx.run.projectRoot, auth.storageStatePath)
      : defaultStorageStatePath(auth.profile, ctx.run.isolationKey);

    // Prefer explicit path; fall back to profile-level shared state when per-run missing.
    const profileShared = path.join(
      RUNTIME_ROOT,
      'auth-state',
      auth.profile.replace(/[^A-Za-z0-9._-]/g, '_'),
      'storage-state.json'
    );

    let storageStatePath: string | undefined;
    if (fs.existsSync(configured) && !isExpired(configured, auth.ttlMinutes)) {
      storageStatePath = configured;
    } else if (fs.existsSync(profileShared) && !isExpired(profileShared, auth.ttlMinutes)) {
      storageStatePath = profileShared;
    }

    if (!storageStatePath) {
      // Soft-miss: auth is optional until a state file exists. Record for diagnostics.
      return {
        variables: {
          WEBPILOT_AUTH_STATE: 'missing',
          WEBPILOT_AUTH_PROFILE: auth.profile,
          WEBPILOT_AUTH_STATE_EXPECTED: configured,
        },
      };
    }

    try {
      fs.chmodSync(storageStatePath, 0o600);
    } catch {
      // best-effort on platforms that ignore mode
    }

    // Never put storage-state contents into variables/reports — only the path for BrowserManager.
    return {
      storageStatePath,
      variables: {
        WEBPILOT_AUTH_STATE: 'ready',
        WEBPILOT_AUTH_PROFILE: auth.profile,
      },
      secretFields: ['cookies', 'origins', 'localStorage', 'sessionStorage'],
    };
  }
}
