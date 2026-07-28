export interface ScenarioMetadata {
  name?: string;
  tags: string[];
  target?: 'web' | 'api' | string;
  baseUrl?: string;
  /** Origin-gated rulebook pack id (e.g. dynamics365, digital). */
  sitePack?: string;
  codegen?: boolean;
  report?: boolean;
  /** Relative path to a fixture manifest (e.g. fixtures/checkout.yaml). */
  fixture?: string;
  format: 'natural-language' | 'bdd' | 'hybrid-metadata';
}

const BOOL_TRUE = new Set(['true', 'yes', 'on', '1']);
const BOOL_FALSE = new Set(['false', 'no', 'off', '0']);
const BDD_PREFIX_RE = /^\s*(Feature:|Scenario:|Given\s+|When\s+|Then\s+|And\s+|But\s+)/i;

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (BOOL_TRUE.has(normalized)) return true;
  if (BOOL_FALSE.has(normalized)) return false;
  return undefined;
}

export class ScenarioMetadataParser {
  public static parse(content: string): ScenarioMetadata {
    const lines = content.split(/\r?\n/);
    const tags = new Set<string>();
    let name: string | undefined;
    let target: string | undefined;
    let baseUrl: string | undefined;
    let sitePack: string | undefined;
    let codegen: boolean | undefined;
    let report: boolean | undefined;
    let fixture: string | undefined;
    let hasMetadata = false;
    let hasBdd = false;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (line.startsWith('@')) {
        hasMetadata = true;
        for (const tag of line.split(/\s+/).filter((part) => part.startsWith('@'))) {
          tags.add(tag);
        }
        continue;
      }

      if (/^Test:/i.test(line)) {
        name = line.replace(/^Test:\s*/i, '').trim();
        continue;
      }
      if (/^Feature:/i.test(line)) {
        hasBdd = true;
        name = name || line.replace(/^Feature:\s*/i, '').trim();
        continue;
      }
      if (/^Scenario:/i.test(line)) {
        hasBdd = true;
        name = line.replace(/^Scenario:\s*/i, '').trim();
        continue;
      }

      const pair = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
      if (pair) {
        hasMetadata = true;
        const key = pair[1].toLowerCase();
        const value = pair[2].trim();
        if (key === 'target') target = value;
        else if (key === 'baseurl') baseUrl = value;
        else if (key === 'sitepack') sitePack = value;
        else if (key === 'codegen') codegen = parseBoolean(value);
        else if (key === 'report') report = parseBoolean(value);
        else if (key === 'fixture') fixture = value;
        continue;
      }

      if (BDD_PREFIX_RE.test(line)) hasBdd = true;
    }

    return {
      name,
      tags: [...tags],
      target,
      baseUrl,
      sitePack,
      codegen,
      report,
      fixture,
      format: hasMetadata ? 'hybrid-metadata' : hasBdd ? 'bdd' : 'natural-language',
    };
  }

  public static parseTags(line: string): string[] {
    return line
      .trim()
      .split(/\s+/)
      .filter((part) => part.startsWith('@'));
  }
}
