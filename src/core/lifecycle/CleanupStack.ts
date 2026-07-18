export type CleanupFn = () => void | Promise<void>;

export interface CleanupEntry {
  name: string;
  run: CleanupFn;
  /** When true, cleanup errors are recorded but do not throw. */
  bestEffort?: boolean;
}

export interface CleanupResult {
  name: string;
  ok: boolean;
  error?: string;
}

/**
 * LIFO cleanup stack. Register reverse operations immediately after successful setup.
 * Always drain under `finally`, even when later setup fails.
 */
export class CleanupStack {
  private readonly entries: CleanupEntry[] = [];
  private drained = false;

  public push(name: string, run: CleanupFn, bestEffort = true): void {
    if (this.drained) {
      throw new Error(`Cannot push cleanup "${name}" after stack was drained`);
    }
    this.entries.push({ name, run, bestEffort });
  }

  public get size(): number {
    return this.entries.length;
  }

  /**
   * Run cleanups in reverse order. Idempotent — subsequent calls return [].
   */
  public async drain(): Promise<CleanupResult[]> {
    if (this.drained) return [];
    this.drained = true;

    const results: CleanupResult[] = [];
    while (this.entries.length) {
      const entry = this.entries.pop()!;
      try {
        await entry.run();
        results.push({ name: entry.name, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ name: entry.name, ok: false, error: message });
        if (!entry.bestEffort) {
          // Continue draining remaining entries, then throw the first hard failure.
          while (this.entries.length) {
            const remaining = this.entries.pop()!;
            try {
              await remaining.run();
              results.push({ name: remaining.name, ok: true });
            } catch (inner) {
              results.push({
                name: remaining.name,
                ok: false,
                error: inner instanceof Error ? inner.message : String(inner),
              });
            }
          }
          const error = new Error(`Cleanup failed: ${entry.name}: ${message}`);
          (error as Error & { cleanupResults: CleanupResult[] }).cleanupResults = results;
          throw error;
        }
      }
    }
    return results;
  }
}
