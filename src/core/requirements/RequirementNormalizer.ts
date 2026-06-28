import {
  AcceptanceCriterion,
  NormalizedRequirement,
  RequirementPriority,
  RequirementSource,
} from './types';

type RawRecord = Record<string, unknown>;

function str(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number') return String(value);
  return undefined;
}

function firstString(record: RawRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = str(record[key]);
    if (value) return value;
  }
  return undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\u00a0/g, ' ');
}

function normalizePriority(value: unknown): RequirementPriority | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  const lowered = raw.toLowerCase();
  if (/\bp?0\b|blocker|critical/.test(lowered)) return 'P0';
  if (/\bp?1\b|high|highest/.test(lowered)) return 'P1';
  if (/\bp?2\b|medium|normal/.test(lowered)) return 'P2';
  if (/\bp?3\b|low|minor|trivial/.test(lowered)) return 'P3';
  return raw;
}

/**
 * Extracts acceptance criteria from a free-text/HTML block. Recognizes an
 * "Acceptance Criteria" heading, bullet/numbered lists, and Given/When/Then.
 */
export function extractAcceptanceCriteria(raw: string | undefined): string[] {
  if (!raw) return [];
  const text = stripHtml(raw);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const criteria: string[] = [];
  let inAcSection = false;
  let sawHeading = false;
  let gwtBuffer: string[] = [];

  const flushGwt = () => {
    if (gwtBuffer.length > 0) {
      criteria.push(gwtBuffer.join(' '));
      gwtBuffer = [];
    }
  };

  for (const line of lines) {
    if (/^acceptance\s+criteria\b/i.test(line)) {
      inAcSection = true;
      sawHeading = true;
      const inline = line.replace(/^acceptance\s+criteria\b[:\-\s]*/i, '').trim();
      if (inline) criteria.push(inline);
      continue;
    }

    const bullet = line.match(/^(?:[-*•]|\d+[.)]|\(\d+\))\s+(.*)$/);
    if (bullet && bullet[1].trim()) {
      flushGwt();
      criteria.push(bullet[1].trim());
      continue;
    }

    if (/^(given|when|then|and|but)\b/i.test(line)) {
      if (/^given\b/i.test(line)) flushGwt();
      gwtBuffer.push(line);
      continue;
    }

    flushGwt();
    // Inside an explicit AC section, treat standalone sentences as criteria.
    if (inAcSection && line.length > 0 && !/^description\b/i.test(line)) {
      criteria.push(line);
    }
  }
  flushGwt();

  // If we never saw a heading or list, fall back to sentence splitting only when
  // the text clearly reads like criteria (contains "should"/"must"/"can").
  if (criteria.length === 0 && !sawHeading && /\b(should|must|can|able to)\b/i.test(text)) {
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const clean = sentence.trim();
      if (clean.length > 8 && /\b(should|must|can|able to)\b/i.test(clean)) {
        criteria.push(clean.replace(/\s+/g, ' '));
      }
    }
  }

  // De-duplicate while preserving order.
  const seen = new Set<string>();
  return criteria
    .map((c) => c.replace(/\s+/g, ' ').trim())
    .filter((c) => {
      const key = c.toLowerCase();
      if (c.length < 4 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function toCriteria(values: string[]): AcceptanceCriterion[] {
  return values.map((text, index) => ({ id: `AC${index + 1}`, text }));
}

function detectSource(record: RawRecord, fallback: RequirementSource): RequirementSource {
  if (record.fields && (record.fields as RawRecord)['System.Title'] !== undefined) return 'ado';
  if (record.key && record.fields && (record.fields as RawRecord).summary !== undefined) return 'jira';
  const explicit = str(record.source);
  if (explicit === 'ado' || explicit === 'jira') return explicit;
  return fallback;
}

function normalizeAdo(record: RawRecord): NormalizedRequirement {
  const fields = (record.fields as RawRecord) || {};
  const id = str(record.id) || str(fields['System.Id']) || `ADO-${str(record.id) ?? 'unknown'}`;
  const acRaw = firstString(fields, [
    'Microsoft.VSTS.Common.AcceptanceCriteria',
    'AcceptanceCriteria',
  ]);
  const description = firstString(fields, ['System.Description', 'description']);
  const tagsRaw = str(fields['System.Tags']);
  const tags = tagsRaw ? tagsRaw.split(/;\s*/).map((t) => t.trim()).filter(Boolean) : [];
  const acTexts = extractAcceptanceCriteria(acRaw) ;
  const fallbackAc = acTexts.length === 0 ? extractAcceptanceCriteria(description) : acTexts;

  return {
    id: id.startsWith('ADO-') ? id : `ADO-${id}`,
    source: 'ado',
    sourceUrl: str(record.url) || str(record._links && ((record._links as RawRecord).html as RawRecord)?.href),
    type: str(fields['System.WorkItemType']),
    title: firstString(fields, ['System.Title']) || `Work item ${id}`,
    description: description ? stripHtml(description) : undefined,
    acceptanceCriteria: toCriteria(fallbackAc),
    priority: normalizePriority(fields['Microsoft.VSTS.Common.Priority']),
    state: str(fields['System.State']),
    team: str(fields['System.AreaPath']),
    sprint: str(fields['System.IterationPath']),
    release: firstString(fields, ['Microsoft.VSTS.Build.IntegrationBuild', 'release']),
    tags,
    links: {},
    updatedAt: str(fields['System.ChangedDate']),
  };
}

function normalizeJira(record: RawRecord): NormalizedRequirement {
  const fields = (record.fields as RawRecord) || {};
  const key = str(record.key) || str(record.id) || 'JIRA-UNKNOWN';
  const description = firstString(fields, ['description']) ?? str(record.description);
  // Jira often stores acceptance criteria in a custom field; scan custom fields.
  let acRaw: string | undefined;
  for (const [fieldKey, value] of Object.entries(fields)) {
    if (/acceptance/i.test(fieldKey)) {
      acRaw = str(value);
      if (acRaw) break;
    }
  }
  const acTexts = extractAcceptanceCriteria(acRaw);
  const fallbackAc = acTexts.length === 0 ? extractAcceptanceCriteria(description) : acTexts;
  const labels = Array.isArray(fields.labels) ? (fields.labels as unknown[]).map(String) : [];
  const priorityName = ((fields.priority as RawRecord) || {}).name;
  const statusName = ((fields.status as RawRecord) || {}).name;
  const sprintRaw = fields.sprint || fields.customfield_sprint;

  return {
    id: key,
    source: 'jira',
    sourceUrl: str(record.self) || str(record.url),
    type: str((fields.issuetype as RawRecord)?.name),
    title: firstString(fields, ['summary']) || `Issue ${key}`,
    description: description ? stripHtml(description) : undefined,
    acceptanceCriteria: toCriteria(fallbackAc),
    priority: normalizePriority(priorityName),
    state: str(statusName),
    team: str((fields.project as RawRecord)?.name),
    sprint: str(sprintRaw),
    release: Array.isArray(fields.fixVersions) && fields.fixVersions.length > 0
      ? str((fields.fixVersions as RawRecord[])[0]?.name)
      : undefined,
    tags: labels,
    links: {},
    updatedAt: str(fields.updated),
  };
}

function normalizeGeneric(record: RawRecord): NormalizedRequirement {
  const id = firstString(record, ['id', 'key', 'ref', 'workItemId']) || 'REQ-UNKNOWN';
  const description = firstString(record, ['description', 'desc', 'details', 'body']);
  const acField = record.acceptanceCriteria ?? record.acceptance_criteria ?? record.ac;
  let acTexts: string[] = [];
  if (Array.isArray(acField)) {
    acTexts = acField.map(String).map((s) => s.trim()).filter(Boolean);
  } else if (typeof acField === 'string') {
    acTexts = extractAcceptanceCriteria(acField);
  }
  if (acTexts.length === 0) acTexts = extractAcceptanceCriteria(description);

  const tags = Array.isArray(record.tags)
    ? (record.tags as unknown[]).map(String)
    : typeof record.tags === 'string'
      ? (record.tags as string).split(/[;,]\s*/).filter(Boolean)
      : [];

  return {
    id,
    source: 'import',
    sourceUrl: firstString(record, ['url', 'link', 'href']),
    type: firstString(record, ['type', 'workItemType', 'issueType']),
    title: firstString(record, ['title', 'name', 'summary']) || `Requirement ${id}`,
    description: description ? stripHtml(description) : undefined,
    acceptanceCriteria: toCriteria(acTexts),
    priority: normalizePriority(record.priority),
    state: firstString(record, ['state', 'status']),
    team: firstString(record, ['team', 'area', 'project']),
    sprint: firstString(record, ['sprint', 'iteration']),
    release: firstString(record, ['release', 'fixVersion', 'milestone']),
    tags,
    links: {},
    updatedAt: firstString(record, ['updatedAt', 'updated', 'changedDate']),
  };
}

export class RequirementNormalizer {
  public static normalizeOne(
    record: RawRecord,
    fallbackSource: RequirementSource = 'import'
  ): NormalizedRequirement {
    const source = detectSource(record, fallbackSource);
    if (source === 'ado') return normalizeAdo(record);
    if (source === 'jira') return normalizeJira(record);
    return normalizeGeneric(record);
  }

  /**
   * Accepts a parsed JSON payload in one of several shapes:
   *  - an array of requirements
   *  - `{ value: [...] }` (ADO REST)
   *  - `{ issues: [...] }` (Jira REST)
   *  - `{ requirements: [...] }`
   */
  public static normalizeMany(
    payload: unknown,
    fallbackSource: RequirementSource = 'import'
  ): NormalizedRequirement[] {
    let list: unknown[] = [];
    if (Array.isArray(payload)) {
      list = payload;
    } else if (payload && typeof payload === 'object') {
      const obj = payload as RawRecord;
      const candidate = obj.value ?? obj.issues ?? obj.requirements ?? obj.workItems ?? obj.items;
      if (Array.isArray(candidate)) list = candidate;
      else list = [obj];
    }

    return list
      .filter((item): item is RawRecord => Boolean(item) && typeof item === 'object')
      .map((item) => RequirementNormalizer.normalizeOne(item, fallbackSource))
      .filter((req) => Boolean(req.id));
  }
}
