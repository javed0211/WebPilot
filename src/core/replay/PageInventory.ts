/**
 * Page-centric inventory (TypeScript) — heal-time recapture + upsert.
 * Mirrors Python runtime/page-inventory/ schema.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export const PAGE_INVENTORY_ROOT = path.join(process.cwd(), 'runtime', 'page-inventory');

export interface InventoryElement {
  backendNodeId?: number | null;
  tag: string;
  axName?: string | null;
  attributes: Record<string, string>;
  xpath?: string | null;
  ancestors?: Array<Record<string, string>>;
}

export interface VerifiedLocatorEntry {
  kind: string;
  value?: string;
  name?: string;
  exact?: boolean;
  scope?: { kind: string; value?: string; name?: string };
  verified?: boolean;
  /** snapshot | playwright — live Playwright is stronger proof. */
  verifiedBy?: string;
  axName?: string | null;
  healedSelector?: string;
  recordedAt?: string;
}

export type SnapshotQuality = 'complete' | 'partial' | 'capped' | 'failed';
export type InventoryReusePolicy = 'prefer' | 'hint' | 'ignore';

export interface PageInventory {
  schemaVersion: number;
  pageKey?: string | null;
  url?: string | null;
  title?: string | null;
  capturedAt?: string | null;
  updatedAt?: string;
  fingerprint?: string | null;
  elementCount: number;
  elements: InventoryElement[];
  verifiedLocators: VerifiedLocatorEntry[];
  /** Coverage — missing ≠ absent when capHit/snapshotQuality say so. */
  domNodesSeen?: number;
  axNodesSeen?: number;
  interactiveCandidatesSeen?: number;
  interactiveCandidatesStored?: number;
  verifiedControlsStored?: number;
  snapshotQuality?: SnapshotQuality | string;
  capHit?: boolean;
  captureCap?: number;
  captureSource?: string;
}

export function inventoryReusePolicy(inv: PageInventory | null | undefined): InventoryReusePolicy {
  if (!inv) return 'ignore';
  const quality = String(inv.snapshotQuality || '').toLowerCase();
  if (quality === 'failed') return 'ignore';
  if (quality === 'complete') return 'prefer';
  if (quality === 'partial' || quality === 'capped') return 'hint';
  if ((inv.verifiedLocators && inv.verifiedLocators.length) || (inv.elements && inv.elements.length)) {
    return 'hint';
  }
  return 'ignore';
}

export function pageKeyFromUrl(url?: string | null): string | null {
  if (!url || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (!/^https?:$/.test(parsed.protocol) || !parsed.host) return null;
    let p = parsed.pathname || '/';
    if (p !== '/' && p.endsWith('/')) p = p.replace(/\/+$/, '');
    const safe = `${parsed.host}${p}`.replace(/[^\w.\-]+/g, '_').replace(/^_|_$/g, '');
    return safe.slice(0, 180) || null;
  } catch {
    return null;
  }
}

export function originFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).host;
    return host.replace(/[^\w.\-]+/g, '_').slice(0, 120) || null;
  } catch {
    return null;
  }
}

export function inventoryPathForUrl(url?: string | null): string | null {
  const origin = originFromUrl(url);
  const key = pageKeyFromUrl(url);
  if (!origin || !key) return null;
  return path.join(PAGE_INVENTORY_ROOT, origin, `${key}.json`);
}

export function loadInventory(url?: string | null): PageInventory | null {
  const file = inventoryPathForUrl(url);
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as PageInventory;
  } catch {
    return null;
  }
}

export function snapshotFromHealPageState(state: {
  url: string;
  title: string;
  elements: Array<{
    tagName: string;
    text: string;
    placeholder: string;
    selector: string;
    selectorCandidates: Array<{ kind: string; value: string; expression: string }>;
  }>;
}): PageInventory {
  const elements: InventoryElement[] = (state.elements || []).slice(0, 120).map((el) => {
    const attrs: Record<string, string> = {};
    if (el.placeholder) attrs.placeholder = el.placeholder;
    if (el.selector?.startsWith('#')) attrs.id = el.selector.slice(1);
    for (const cand of el.selectorCandidates || []) {
      if (cand.kind === 'testid' && cand.value) attrs['data-testid'] = cand.value;
    }
    return {
      backendNodeId: null,
      tag: (el.tagName || '*').toLowerCase(),
      axName: (el.text || '').slice(0, 200) || null,
      attributes: attrs,
      xpath: null,
      ancestors: [],
    };
  });
  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(elements.slice(0, 40).map((e) => [e.tag, e.axName])))
    .digest('hex')
    .slice(0, 16);
  const seen = (state.elements || []).length;
  const stored = elements.length;
  const cap = 120;
  const capHit = seen > cap || stored >= cap;
  let snapshotQuality: SnapshotQuality = 'complete';
  if (stored === 0) snapshotQuality = 'failed';
  else if (capHit) snapshotQuality = 'capped';
  else if (stored < Math.max(1, Math.floor(seen / 2)) && seen > 10) snapshotQuality = 'partial';

  return {
    schemaVersion: 2,
    pageKey: pageKeyFromUrl(state.url),
    url: state.url,
    title: state.title,
    capturedAt: new Date().toISOString(),
    fingerprint,
    elementCount: elements.length,
    elements,
    verifiedLocators: [],
    domNodesSeen: seen,
    axNodesSeen: seen,
    interactiveCandidatesSeen: seen,
    interactiveCandidatesStored: stored,
    verifiedControlsStored: 0,
    snapshotQuality,
    capHit,
    captureCap: cap,
    captureSource: 'heal_page_state',
  };
}

export function upsertInventory(
  snapshot: PageInventory,
  opts?: { verifiedLocator?: VerifiedLocatorEntry; axName?: string | null }
): string | null {
  const file = inventoryPathForUrl(snapshot.url);
  if (!file) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = loadInventory(snapshot.url) || ({} as Partial<PageInventory>);
  const merged: PageInventory = {
    schemaVersion: 2,
    pageKey: snapshot.pageKey ?? existing.pageKey ?? null,
    url: snapshot.url ?? existing.url ?? null,
    title: snapshot.title ?? existing.title ?? null,
    capturedAt: snapshot.capturedAt ?? existing.capturedAt ?? null,
    updatedAt: new Date().toISOString(),
    fingerprint: snapshot.fingerprint ?? existing.fingerprint ?? null,
    elementCount: snapshot.elementCount || existing.elementCount || 0,
    elements:
      snapshot.elements?.length
        ? snapshot.elements
        : existing.elements || [],
    verifiedLocators: [...(existing.verifiedLocators || [])],
    domNodesSeen: snapshot.domNodesSeen ?? existing.domNodesSeen,
    axNodesSeen: snapshot.axNodesSeen ?? existing.axNodesSeen,
    interactiveCandidatesSeen:
      snapshot.interactiveCandidatesSeen ?? existing.interactiveCandidatesSeen,
    interactiveCandidatesStored:
      snapshot.interactiveCandidatesStored ?? existing.interactiveCandidatesStored,
    snapshotQuality: snapshot.snapshotQuality ?? existing.snapshotQuality,
    capHit: snapshot.capHit ?? existing.capHit,
    captureCap: snapshot.captureCap ?? existing.captureCap,
    captureSource: snapshot.captureSource ?? existing.captureSource,
  };
  if (!merged.elements.length && existing.elements?.length) {
    merged.elements = existing.elements;
    merged.elementCount = existing.elementCount || existing.elements.length;
  }

  if (opts?.verifiedLocator) {
    const entry: VerifiedLocatorEntry = {
      ...opts.verifiedLocator,
      axName: opts.axName ?? opts.verifiedLocator.axName,
      verified: true,
      recordedAt: new Date().toISOString(),
    };
    const key = `${entry.kind}|${entry.value || ''}|${entry.name || ''}`;
    merged.verifiedLocators = [
      entry,
      ...merged.verifiedLocators.filter(
        (v) => `${v.kind}|${v.value || ''}|${v.name || ''}` !== key
      ),
    ].slice(0, 40);
  }
  merged.verifiedControlsStored = merged.verifiedLocators.length;

  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return file;
}

/** Record a locator that succeeded under live Playwright (replay trust gate). */
export function upsertLiveVerifiedLocator(
  url: string | null | undefined,
  locator: {
    kind: string;
    value?: string;
    name?: string;
    exact?: boolean;
    scope?: { kind: string; value?: string; name?: string };
  },
  axName?: string | null
): string | null {
  if (!url) return null;
  return upsertInventory(
    {
      schemaVersion: 2,
      url,
      pageKey: pageKeyFromUrl(url),
      title: null,
      capturedAt: null,
      fingerprint: null,
      elementCount: 0,
      elements: [],
      verifiedLocators: [],
    },
    {
      verifiedLocator: {
        ...locator,
        verified: true,
        verifiedBy: 'playwright',
        axName: axName ?? locator.name ?? null,
      },
      axName: axName ?? locator.name ?? null,
    }
  );
}

/** Parse a healed Playwright selector string into a verified locator entry. */
export function verifiedLocatorFromHealedSelector(healed: string): VerifiedLocatorEntry | null {
  const trimmed = healed.trim().replace(/^page\./, '');
  const role = trimmed.match(
    /getByRole\(\s*['"]([^'"]+)['"]\s*,\s*\{\s*name:\s*['"]([^'"]*)['"][^}]*\}/
  );
  if (role) {
    return { kind: 'role', value: role[1], name: role[2], exact: true, healedSelector: healed };
  }
  const testid = trimmed.match(/getByTestId\(\s*['"]([^'"]+)['"]/);
  if (testid) return { kind: 'testid', value: testid[1], healedSelector: healed };
  const text = trimmed.match(/getByText\(\s*['"]([^'"]+)['"]/);
  if (text) return { kind: 'text', value: text[1], exact: true, healedSelector: healed };
  const loc = trimmed.match(/locator\(\s*['"]([^'"]+)['"]/);
  if (loc) return { kind: 'css', value: loc[1], healedSelector: healed };
  return { kind: 'css', value: trimmed, healedSelector: healed };
}
