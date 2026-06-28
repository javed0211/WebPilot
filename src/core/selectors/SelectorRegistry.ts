import * as fs from 'fs';
import * as path from 'path';
import {
  RankedSelectorSet,
  SelectorCandidate,
  SelectorRegistryEntry,
  SelectorRegistryFile,
} from './SelectorCandidate';
import { SELECTOR_REGISTRY_PATH, SELECTORS_ROOT } from '../ProjectPaths';

function actionKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'unknown_action';
}

function pageKey(url?: string): string {
  if (!url) return 'unknown';
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, '') || parsed.hostname;
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '') || 'unknown';
  }
}

function emptyRegistry(): SelectorRegistryFile {
  return {
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    selectors: {},
  };
}

export class SelectorRegistry {
  public static keyFor(url: string | undefined, action: string): { page: string; action: string } {
    return {
      page: pageKey(url),
      action: actionKey(action),
    };
  }

  public static load(registryPath = SELECTOR_REGISTRY_PATH): SelectorRegistryFile {
    if (!fs.existsSync(registryPath)) return emptyRegistry();
    try {
      return JSON.parse(fs.readFileSync(registryPath, 'utf8')) as SelectorRegistryFile;
    } catch {
      return emptyRegistry();
    }
  }

  public static save(registry: SelectorRegistryFile, registryPath = SELECTOR_REGISTRY_PATH): void {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    registry.updatedAt = new Date().toISOString();
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');
  }

  public static get(url: string | undefined, action: string): SelectorRegistryEntry | undefined {
    const registry = SelectorRegistry.load();
    const key = SelectorRegistry.keyFor(url, action);
    return registry.selectors[key.page]?.[key.action];
  }

  public static record(url: string | undefined, action: string, ranked: RankedSelectorSet): void {
    fs.mkdirSync(SELECTORS_ROOT, { recursive: true });
    const registry = SelectorRegistry.load();
    const key = SelectorRegistry.keyFor(url, action);
    registry.selectors[key.page] ||= {};

    const existing = registry.selectors[key.page][key.action];
    registry.selectors[key.page][key.action] = {
      primary: SelectorRegistry.mergeCandidate(existing?.primary, ranked.primary),
      fallbacks: SelectorRegistry.mergeFallbacks(ranked.fallbacks, existing?.fallbacks),
      lastVerifiedAt: new Date().toISOString(),
      successCount: (existing?.successCount || 0) + 1,
      failureCount: existing?.failureCount || 0,
    };

    SelectorRegistry.save(registry);
  }

  public static recordFailure(url: string | undefined, action: string): void {
    const registry = SelectorRegistry.load();
    const key = SelectorRegistry.keyFor(url, action);
    const existing = registry.selectors[key.page]?.[key.action];
    if (!existing) return;
    existing.failureCount += 1;
    SelectorRegistry.save(registry);
  }

  private static mergeCandidate(
    existing: SelectorCandidate | undefined,
    next: SelectorCandidate
  ): SelectorCandidate {
    if (!existing) return next;
    const successBonus = Math.min(0.05, 0.01);
    return {
      ...next,
      confidence: Math.min(0.99, Number((next.confidence + successBonus).toFixed(2))),
      signals: [...new Set([...next.signals, 'historical-success'])],
    };
  }

  private static mergeFallbacks(
    next: SelectorCandidate[],
    existing: SelectorCandidate[] = []
  ): SelectorCandidate[] {
    const byExpression = new Map<string, SelectorCandidate>();
    for (const candidate of [...next, ...existing]) {
      byExpression.set(candidate.frameworkExpression, candidate);
    }
    return [...byExpression.values()]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }
}
