/**
 * Page inventory history + fingerprint drift (feature 11 Phase 3).
 * Layout: runtime/page-inventory/<origin>/history/<pageKey>/<timestamp>.json
 * Current snapshot stays at <origin>/<pageKey>.json (unchanged).
 */
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../ConfigManager';
import type { EvidencePageDrift } from '../evidence/types';
import {
  PAGE_INVENTORY_ROOT,
  inventoryPathForUrl,
  loadInventory,
  originFromUrl,
  pageKeyFromUrl,
  type InventoryElement,
  type PageInventory,
} from './PageInventory';

export interface InventoryHistoryConfig {
  enabled: boolean;
  maxSnapshotsPerPage: number;
}

export interface InventoryDiff {
  added: number;
  removed: number;
  changed: number;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
  }
  return fallback;
}

function asNum(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveInventoryHistoryConfig(cm?: ConfigManager): InventoryHistoryConfig {
  const config = cm || ConfigManager.getInstance();
  const evidence = (config.get('evidence', {}) || {}) as Record<string, unknown>;
  const hist = (evidence.pageInventoryHistory || {}) as Record<string, unknown>;
  return {
    enabled: asBool(hist.enabled, true),
    maxSnapshotsPerPage: Math.max(1, asNum(hist.maxSnapshotsPerPage, 20)),
  };
}

export function inventoryHistoryDir(origin: string, pageKey: string): string {
  return path.join(PAGE_INVENTORY_ROOT, origin, 'history', pageKey);
}

function elementIdentity(el: InventoryElement): string {
  const id = el.attributes?.id || '';
  const testid = el.attributes?.['data-testid'] || '';
  return `${(el.tag || '').toLowerCase()}|${el.axName || ''}|${id}|${testid}`;
}

/**
 * Compare interactive control sets between two inventory snapshots.
 */
export function diffInventoryElements(
  previous: InventoryElement[] | undefined,
  current: InventoryElement[] | undefined
): InventoryDiff {
  const prev = previous || [];
  const curr = current || [];
  const prevMap = new Map(prev.map((e) => [elementIdentity(e), e]));
  const currMap = new Map(curr.map((e) => [elementIdentity(e), e]));

  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const [key, cur] of currMap) {
    const old = prevMap.get(key);
    if (!old) {
      added += 1;
      continue;
    }
    const attrChanged =
      JSON.stringify(old.attributes || {}) !== JSON.stringify(cur.attributes || {});
    if (attrChanged) changed += 1;
  }
  for (const key of prevMap.keys()) {
    if (!currMap.has(key)) removed += 1;
  }

  return { added, removed, changed };
}

function pruneHistory(dir: string, maxSnapshots: number): void {
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const excess = files.length - maxSnapshots;
  if (excess <= 0) return;
  for (const f of files.slice(0, excess)) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Archive the previous inventory when fingerprint changes (or first denser capture).
 * Returns the archive path, or null if nothing was archived.
 */
export function archiveInventoryIfChanged(
  existing: Partial<PageInventory> | null | undefined,
  next: Pick<PageInventory, 'fingerprint' | 'elements' | 'url' | 'pageKey'>,
  config?: InventoryHistoryConfig
): string | null {
  const cfg = config || resolveInventoryHistoryConfig();
  if (!cfg.enabled || !existing) return null;

  const prevFp = existing.fingerprint;
  const nextFp = next.fingerprint;
  if (!prevFp || !nextFp) return null;
  if (prevFp === nextFp) return null;
  if (!existing.elements?.length) return null;

  const origin = originFromUrl(existing.url || next.url || null);
  const pageKey =
    existing.pageKey ||
    next.pageKey ||
    pageKeyFromUrl(existing.url || next.url || null);
  if (!origin || !pageKey) return null;

  const dir = inventoryHistoryDir(origin, pageKey);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = (existing.updatedAt || existing.capturedAt || new Date().toISOString())
    .replace(/[:.]/g, '-')
    .replace(/Z$/, 'Z');
  const outPath = path.join(dir, `${stamp}.json`);
  const payload = {
    schemaVersion: existing.schemaVersion || 2,
    pageKey,
    url: existing.url,
    title: existing.title,
    capturedAt: existing.capturedAt,
    updatedAt: existing.updatedAt,
    fingerprint: prevFp,
    elementCount: existing.elementCount || existing.elements.length,
    elements: existing.elements,
    archivedAt: new Date().toISOString(),
    nextFingerprint: nextFp,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  pruneHistory(dir, cfg.maxSnapshotsPerPage);
  return outPath;
}

export function loadLatestHistorySnapshot(
  url: string
): (PageInventory & { archivedAt?: string }) | null {
  const origin = originFromUrl(url);
  const pageKey = pageKeyFromUrl(url);
  if (!origin || !pageKey) return null;
  const dir = inventoryHistoryDir(origin, pageKey);
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const latest = files[files.length - 1];
  if (!latest) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, latest), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Build drift records for URLs touched in a run by comparing current inventory
 * to the latest archived fingerprint (when history exists).
 */
export function computePageDrift(urls: string[]): EvidencePageDrift[] {
  const seen = new Set<string>();
  const drift: EvidencePageDrift[] = [];

  for (const url of urls) {
    const pageKey = pageKeyFromUrl(url);
    if (!pageKey || seen.has(pageKey)) continue;
    seen.add(pageKey);

    const current = loadInventory(url);
    if (!current?.fingerprint) continue;

    const previous = loadLatestHistorySnapshot(url);
    if (!previous?.fingerprint) continue;
    if (previous.fingerprint === current.fingerprint) continue;

    const diff = diffInventoryElements(previous.elements, current.elements);
    drift.push({
      pageKey,
      previousFingerprint: previous.fingerprint,
      currentFingerprint: current.fingerprint,
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed,
    });
  }

  return drift;
}

/** Load inventory by absolute/relative path for tests. */
export function loadInventoryFile(filePath: string): PageInventory | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PageInventory;
  } catch {
    return null;
  }
}

export function inventoryFileForKey(origin: string, pageKey: string): string {
  return path.join(PAGE_INVENTORY_ROOT, origin, `${pageKey}.json`);
}

export { inventoryPathForUrl };
