import type { CleanupStack } from '../CleanupStack';
import type { FixtureLease, FixtureManifest, LifecycleRunContext } from '../FixtureTypes';
import type { SecretRegistry } from '../SecretRegistry';

export interface FixtureProviderResult {
  variables?: Record<string, unknown>;
  storageStatePath?: string;
  tempDir?: string;
  seedId?: string;
  /** Secret field names discovered during provisioning. */
  secretFields?: string[];
}

export interface FixtureProviderContext {
  run: LifecycleRunContext;
  manifest: FixtureManifest;
  cleanup: CleanupStack;
  secrets: SecretRegistry;
  /** Mutable variable bag (env + prior providers). */
  variables: Record<string, unknown>;
}

export interface FixtureProvider {
  readonly kind: string;
  apply(ctx: FixtureProviderContext): Promise<FixtureProviderResult>;
}

export function interpolateTemplate(
  template: string,
  variables: Record<string, unknown>
): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
    const value = getNested(variables, key);
    return value == null ? '' : String(value);
  });
}

export function getNested(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function mergeLease(
  lease: FixtureLease,
  result: FixtureProviderResult
): FixtureLease {
  return {
    ...lease,
    variables: { ...lease.variables, ...(result.variables || {}) },
    storageStatePath: result.storageStatePath || lease.storageStatePath,
    tempDir: result.tempDir || lease.tempDir,
    seedId: result.seedId || lease.seedId,
  };
}
