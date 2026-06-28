import * as fs from 'fs';
import * as path from 'path';
import {
  REQUIREMENTS_NORMALIZED_DIR,
  REQUIREMENTS_NORMALIZED_PATH,
} from '../ProjectPaths';
import { NormalizedRequirement, RequirementScope, RequirementSet, RequirementSource } from './types';
import { RequirementNormalizer } from './RequirementNormalizer';

export class RequirementStore {
  public static load(): RequirementSet | null {
    if (!fs.existsSync(REQUIREMENTS_NORMALIZED_PATH)) return null;
    try {
      return JSON.parse(fs.readFileSync(REQUIREMENTS_NORMALIZED_PATH, 'utf8')) as RequirementSet;
    } catch {
      return null;
    }
  }

  public static save(set: RequirementSet): void {
    fs.mkdirSync(REQUIREMENTS_NORMALIZED_DIR, { recursive: true });
    fs.writeFileSync(REQUIREMENTS_NORMALIZED_PATH, JSON.stringify(set, null, 2), 'utf8');
  }

  public static importPayload(
    payload: unknown,
    options: { source?: RequirementSource; scope?: RequirementScope; merge?: boolean } = {}
  ): { set: RequirementSet; added: number; updated: number } {
    const incoming = RequirementNormalizer.normalizeMany(payload, options.source ?? 'import');
    if (incoming.length === 0) {
      throw new Error('No requirements found in the sync/import payload.');
    }

    const existing = options.merge !== false ? RequirementStore.load() : null;
    const byId = new Map<string, NormalizedRequirement>();
    for (const req of existing?.requirements ?? []) byId.set(req.id, req);

    let added = 0;
    let updated = 0;
    for (const req of incoming) {
      if (byId.has(req.id)) updated += 1;
      else added += 1;
      byId.set(req.id, req);
    }

    const set: RequirementSet = {
      version: 1,
      generatedAt: new Date().toISOString(),
      scope: options.scope ?? existing?.scope ?? {},
      requirements: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    };
    RequirementStore.save(set);
    return { set, added, updated };
  }

  /**
   * Imports requirements from a JSON file (generic, ADO REST, or Jira REST
   * shape) and merges them into the normalized store by id.
   */
  public static importFromFile(
    filePath: string,
    options: { source?: RequirementSource; scope?: RequirementScope; merge?: boolean } = {}
  ): { set: RequirementSet; added: number; updated: number } {
    const abs = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(abs)) {
      throw new Error(`Requirements file not found: ${abs}`);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (err) {
      throw new Error(
        `Failed to parse requirements JSON (${abs}): ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return RequirementStore.importPayload(payload, options);
  }
}
