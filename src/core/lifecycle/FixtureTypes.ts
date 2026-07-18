/**
 * Fixture / lifecycle type contracts.
 * V1 providers are registered adapters — no arbitrary shell/JS hooks.
 */

export type LifecyclePhaseName =
  | 'suiteSetup'
  | 'testSetup'
  | 'seed'
  | 'acquireAuthState'
  | 'beforeBrowserContext'
  | 'beforeApiContext'
  | 'beforeTest'
  | 'afterTest'
  | 'teardown'
  | 'failureCleanup'
  | 'suiteTeardown';

export type FixtureProviderKind = 'static-json' | 'http-seed' | 'temp-dir' | 'playwright-storage-state';

export interface FixtureIsolationSpec {
  strategy: 'per-run' | 'per-worker' | 'shared';
}

export interface FixtureAuthSpec {
  provider: 'playwright-storage-state';
  profile: string;
  /** Relative path under runtime/ for storage state (never reported). */
  storageStatePath?: string;
  ttlMinutes?: number;
}

export interface FixtureRedactionSpec {
  fields?: string[];
}

export interface FixtureHttpSeedSpec {
  provider: 'http-seed';
  method?: string;
  /** Absolute URL or path relative to apiBaseUrl/baseUrl. Supports {{var}} interpolation. */
  url: string;
  /** JSON body file relative to project root. */
  bodyPath?: string;
  /** Inline JSON body (alternative to bodyPath). */
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  cleanup?: {
    method?: string;
    /** Supports {{id}} and other variables from the seed response. */
    urlTemplate: string;
    /** Dot-path into the JSON response used as {{id}} (default: id). */
    idPath?: string;
  };
}

export interface FixtureStaticSeedSpec {
  provider?: 'static-json';
  dataset?: string;
  /** JSON file relative to project root; values merge into scenario variables. */
  path: string;
}

export interface FixtureTempDirSpec {
  provider: 'temp-dir';
  /** Optional subdirectory name prefix. */
  prefix?: string;
}

export interface FixtureSetupSpec {
  provider: FixtureProviderKind;
  operation?: string;
  path?: string;
}

export interface FixtureTeardownSpec {
  provider?: FixtureProviderKind;
  operation?: string;
  /** Explicit cleanup URL for http-seed when not declared on seed. */
  url?: string;
  method?: string;
}

export interface FixtureManifest {
  schemaVersion: 1;
  name?: string;
  setup?: FixtureSetupSpec;
  seed?: FixtureStaticSeedSpec | FixtureHttpSeedSpec | FixtureTempDirSpec;
  auth?: FixtureAuthSpec;
  isolation?: FixtureIsolationSpec;
  teardown?: FixtureTeardownSpec;
  failureCleanup?: {
    enabled: boolean;
  };
  redaction?: FixtureRedactionSpec;
}

export interface LifecycleRunContext {
  runId: string;
  scenarioId: string;
  environment: string;
  workerIndex?: number;
  retryAttempt?: number;
  fixturePath?: string;
  isolationKey: string;
  /** Env/base variables available for URL interpolation. */
  variables: Record<string, unknown>;
  projectRoot: string;
}

export interface FixtureLease {
  context: LifecycleRunContext;
  manifest: FixtureManifest;
  /** Merged seed/auth variables for the scenario (secrets marked via SecretRegistry). */
  variables: Record<string, unknown>;
  /** Absolute path to Playwright storage state, if acquired. */
  storageStatePath?: string;
  /** Absolute path to a per-test temp directory, if created. */
  tempDir?: string;
  /** HTTP seed response id when applicable. */
  seedId?: string;
}

export function buildIsolationKey(parts: {
  runId: string;
  environment: string;
  scenarioId: string;
  workerIndex?: number;
  retryAttempt?: number;
}): string {
  return [
    parts.environment,
    parts.scenarioId,
    parts.runId,
    `w${parts.workerIndex ?? 0}`,
    `r${parts.retryAttempt ?? 0}`,
  ].join('|');
}
