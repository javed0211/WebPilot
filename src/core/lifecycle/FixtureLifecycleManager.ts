import { PROJECT_ROOT } from '../ProjectPaths';
import { createRunId } from '../events/ExecutionEvent';
import type { ExecutionEventLedger } from '../events/ExecutionEventLedger';
import { CleanupStack, type CleanupResult } from './CleanupStack';
import { FixtureManifestParser } from './FixtureManifestParser';
import {
  buildIsolationKey,
  type FixtureLease,
  type FixtureManifest,
  type LifecycleRunContext,
} from './FixtureTypes';
import { SecretRegistry } from './SecretRegistry';
import { HttpSeedProvider } from './providers/HttpSeedProvider';
import { PlaywrightStorageStateProvider } from './providers/PlaywrightStorageStateProvider';
import { StaticJsonProvider } from './providers/StaticJsonProvider';
import { TempDirProvider } from './providers/TempDirProvider';
import {
  mergeLease,
  type FixtureProvider,
  type FixtureProviderResult,
} from './providers/FixtureProvider';

export interface FixtureLifecycleOptions {
  scenarioId: string;
  environment: string;
  fixturePath: string;
  projectRoot?: string;
  workerIndex?: number;
  retryAttempt?: number;
  runId?: string;
  /** Base variables (env credentials, baseUrl, etc.). */
  variables?: Record<string, unknown>;
  eventLedger?: ExecutionEventLedger | null;
}

export interface FixtureLifecycleSession {
  lease: FixtureLease;
  secrets: SecretRegistry;
  cleanup: CleanupStack;
  teardown: (opts?: { failed?: boolean }) => Promise<CleanupResult[]>;
}

/**
 * Coordinates fixture setup/seed/auth and registers reverse cleanups.
 * Call `teardown()` from a finally block.
 */
export class FixtureLifecycleManager {
  private static providers: FixtureProvider[] = [
    new StaticJsonProvider(),
    new TempDirProvider(),
    new HttpSeedProvider(),
    new PlaywrightStorageStateProvider(),
  ];

  public static async start(options: FixtureLifecycleOptions): Promise<FixtureLifecycleSession> {
    const projectRoot = options.projectRoot || PROJECT_ROOT;
    const runId = options.runId || createRunId(options.scenarioId);
    const isolationKey = buildIsolationKey({
      runId,
      environment: options.environment,
      scenarioId: options.scenarioId,
      workerIndex: options.workerIndex,
      retryAttempt: options.retryAttempt,
    });

    const manifest = FixtureManifestParser.parseFile(options.fixturePath, projectRoot);
    const secrets = new SecretRegistry(manifest.redaction?.fields || []);
    const cleanup = new CleanupStack();
    const variables: Record<string, unknown> = { ...(options.variables || {}) };

    const context: LifecycleRunContext = {
      runId,
      scenarioId: options.scenarioId,
      environment: options.environment,
      workerIndex: options.workerIndex,
      retryAttempt: options.retryAttempt,
      fixturePath: options.fixturePath,
      isolationKey,
      variables,
      projectRoot,
    };

    let lease: FixtureLease = {
      context,
      manifest,
      variables: { ...variables },
    };

    options.eventLedger?.append({
      kind: 'lifecycle',
      phase: 'setup',
      outcome: 'started',
      payload: {
        name: 'fixture.start',
        fixturePath: options.fixturePath,
        isolationKey,
        manifestName: manifest.name,
      },
    });

    try {
      // setup.path with static-json
      if (manifest.setup?.provider === 'static-json' || manifest.setup?.path) {
        const result = await this.runProvider('static-json', {
          run: context,
          manifest,
          cleanup,
          secrets,
          variables: lease.variables,
        });
        lease = mergeLease(lease, result);
        Object.assign(variables, result.variables || {});
        secrets.registerMany(result.secretFields || []);
      }

      if (manifest.seed) {
        const kind =
          'provider' in manifest.seed && manifest.seed.provider
            ? manifest.seed.provider
            : 'static-json';
        const result = await this.runProvider(kind, {
          run: context,
          manifest,
          cleanup,
          secrets,
          variables: lease.variables,
        });
        lease = mergeLease(lease, result);
        Object.assign(variables, result.variables || {});
        Object.assign(lease.variables, result.variables || {});
        secrets.registerMany(result.secretFields || []);
        options.eventLedger?.append({
          kind: 'lifecycle',
          phase: 'seed',
          outcome: 'passed',
          payload: {
            name: 'fixture.seed',
            provider: kind,
            seedId: result.seedId,
            tempDir: result.tempDir,
          },
        });
      }

      if (manifest.auth) {
        const result = await this.runProvider('playwright-storage-state', {
          run: context,
          manifest,
          cleanup,
          secrets,
          variables: lease.variables,
        });
        lease = mergeLease(lease, result);
        Object.assign(lease.variables, result.variables || {});
        secrets.registerMany(result.secretFields || []);
        options.eventLedger?.append({
          kind: 'lifecycle',
          phase: 'auth',
          outcome: result.storageStatePath ? 'passed' : 'skipped',
          payload: {
            name: 'fixture.auth',
            profile: manifest.auth.profile,
            // Never log storage-state contents — only presence.
            hasStorageState: Boolean(result.storageStatePath),
          },
        });
      }

      options.eventLedger?.append({
        kind: 'lifecycle',
        phase: 'setup',
        outcome: 'passed',
        payload: { name: 'fixture.ready', cleanupRegistered: cleanup.size },
      });
    } catch (err) {
      options.eventLedger?.append({
        kind: 'lifecycle',
        phase: 'setup',
        outcome: 'failed',
        payload: {
          name: 'fixture.failed',
          error: err instanceof Error ? err.message : String(err),
        },
      });
      // Drain any partial cleanups before rethrowing.
      await cleanup.drain();
      throw err;
    }

    const failureCleanupEnabled = manifest.failureCleanup?.enabled !== false;

    return {
      lease,
      secrets,
      cleanup,
      teardown: async ({ failed } = {}) => {
        options.eventLedger?.append({
          kind: 'lifecycle',
          phase: failed ? 'cleanup' : 'teardown',
          outcome: 'started',
          payload: {
            name: failed ? 'fixture.failureCleanup' : 'fixture.teardown',
            enabled: failed ? failureCleanupEnabled : true,
          },
        });
        if (failed && !failureCleanupEnabled) {
          return [];
        }
        const results = await cleanup.drain();
        options.eventLedger?.append({
          kind: 'lifecycle',
          phase: failed ? 'cleanup' : 'teardown',
          outcome: results.every((r) => r.ok) ? 'passed' : 'failed',
          payload: {
            name: failed ? 'fixture.failureCleanup.done' : 'fixture.teardown.done',
            results: results.map((r) => ({
              name: r.name,
              ok: r.ok,
              error: r.error,
            })),
          },
        });
        return results;
      },
    };
  }

  private static async runProvider(
    kind: string,
    ctx: Parameters<FixtureProvider['apply']>[0]
  ): Promise<FixtureProviderResult> {
    const provider = this.providers.find((p) => p.kind === kind);
    if (!provider) {
      throw new Error(`No fixture provider registered for kind: ${kind}`);
    }
    return provider.apply(ctx);
  }
}
