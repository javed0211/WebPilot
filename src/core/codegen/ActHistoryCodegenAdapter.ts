import * as fs from 'fs';
import { resolveExecutionHistoryPath } from '../ReportPaths';
import { RawExecutionStep } from './ExecutionTrace';
import { filterActHistoryForCodegen } from './ActHistoryCodegenFilter';
import { sanitizeActHistoryForReplay } from '../replay/ActHistorySanitizer';
import { Logger } from '../../utils/Logger';

export interface AssertionPlanItem {
  index?: number;
  kind?: string;
  nlStep?: string;
}

export interface ActHistoryCodegenSource {
  scenario: string;
  scenarioSlug: string;
  sourceFile?: string;
  historySource?: string;
  steps: RawExecutionStep[];
  assertionPlan: AssertionPlanItem[];
  nlSteps: string[];
  targetUrl?: string;
}

function extractAssertText(step: string): string | null {
  let text = step.trim();
  text = text.replace(/^(verify|assert|check|ensure)\s+/i, '');
  text = text.replace(/\s+(is|are)\s+(visible|displayed|shown|present|loaded).*$/i, '');
  text = text.replace(/\s+loads?\s+successfully.*$/i, '');
  text = text.replace(/^that\s+/i, '');
  text = text.replace(/^the\s+/i, '');
  text = text.replace(/[."']+$/g, '').trim();
  if (!text || text.length > 120) return null;
  return text;
}

function assertionPlanToSteps(
  plan: AssertionPlanItem[],
  urlHint?: string
): RawExecutionStep[] {
  const steps: RawExecutionStep[] = [];
  for (const item of plan) {
    const nl = (item.nlStep || '').trim();
    if (!nl) continue;
    const kind = String(item.kind || 'assert').toLowerCase();

    if (kind === 'screenshot') {
      const text = extractAssertText(nl) || nl;
      steps.push({
        index: steps.length + 1,
        action: 'screenshot',
        description: nl,
        value: text,
        selector: text
          ? JSON.stringify([{ kind: 'text', value: text }])
          : null,
        url: null,
      });
      continue;
    }

    const urlContains = nl.match(/url\s+contains\s+(.+)$/i);
    if (urlContains) {
      const fragment = urlContains[1].replace(/[."']+$/g, '').trim();
      steps.push({
        index: steps.length + 1,
        action: 'assert',
        description: nl,
        value: `__url_contains__:${fragment}`,
        url: urlHint || null,
      });
      continue;
    }

    if (/\b(loads?\s+successfully|homepage\s+loads)\b/i.test(nl) && urlHint) {
      steps.push({
        index: steps.length + 1,
        action: 'assert',
        description: nl,
        value: `__url_equals__:${urlHint}`,
        url: urlHint,
      });
      continue;
    }

    const text = extractAssertText(nl);
    // Plain verify-text must use getByText — never invent role:link (flaky for body copy).
    const locators = text
      ? [
          { kind: 'text', value: text },
          ...(/\bheading\b/i.test(nl)
            ? [{ kind: 'role', value: 'heading', name: text }]
            : []),
        ]
      : [];
    steps.push({
      index: steps.length + 1,
      action: 'assert',
      description: nl,
      value: text,
      selector: locators.length ? JSON.stringify(locators) : null,
      url: null,
    });
  }
  return steps;
}

function normalizeActStep(step: any, index: number): RawExecutionStep {
  let selector = step.selector ?? null;
  if ((!selector || selector === 'null') && Array.isArray(step.locators) && step.locators.length) {
    selector = JSON.stringify(step.locators);
  }
  return {
    index: step.index ?? index + 1,
    action: String(step.action || 'custom'),
    selector,
    value: step.value ?? null,
    url: step.url ?? null,
    description: String(step.description || `${step.action || 'step'} ${index + 1}`),
    locators: Array.isArray(step.locators) ? step.locators : undefined,
  };
}

/**
 * Build codegen input steps from saved ActHistory (+ assertionPlan for expects).
 * Prefer actHistory over legacy NL-zipped executionHistory.
 */
export class ActHistoryCodegenAdapter {
  public static fromDocument(raw: any, slug: string): ActHistoryCodegenSource {
    const actSteps = (raw.actHistory || []) as any[];
    const legacySteps = (raw.executionHistory || raw.steps || []) as any[];
    const sourceSteps = actSteps.length ? actSteps : legacySteps;
    const acts = sourceSteps.map((step, i) => normalizeActStep(step, i));

    const assertionPlan = (raw.assertionPlan || []) as AssertionPlanItem[];
    const firstUrl =
      acts.find((s) => s.action === 'navigate' && s.url)?.url ||
      acts.find((s) => s.url)?.url ||
      undefined;
    const assertSteps = assertionPlanToSteps(assertionPlan, firstUrl || undefined);

    // Acts first (browser-use truth), then NL assertion intents for codegen expects.
    // Drop search_page / extract / evaluate noise — those invent bad POM methods.
    const mergedRaw = [...acts, ...assertSteps].map((step, i) => ({
      ...step,
      index: i + 1,
    }));
    const filtered = filterActHistoryForCodegen(mergedRaw);
    const sanitized = sanitizeActHistoryForReplay(filtered.steps as import('../replay/ActHistoryTypes').ActStep[]);
    if (filtered.dropped > 0 || sanitized.dropped > 0 || sanitized.merged > 0) {
      Logger.detail(
        `ActHistory codegen filter: dropped ${filtered.dropped} noise step(s);` +
          ` replay sanitize: ${mergedRaw.length} → ${sanitized.steps.length}` +
          (sanitized.merged ? ` (merged ${sanitized.merged})` : '')
      );
    }
    const merged = sanitized.steps as RawExecutionStep[];

    return {
      scenario: raw.scenario || raw.testName || slug,
      scenarioSlug: slug,
      sourceFile: raw.sourceFile,
      historySource: raw.historySource || (actSteps.length ? 'browser-use-act-history' : 'legacy'),
      steps: merged,
      assertionPlan,
      nlSteps: Array.isArray(raw.nlSteps) ? raw.nlSteps : [],
      targetUrl: firstUrl || undefined,
    };
  }

  public static loadFromSlug(slug: string): ActHistoryCodegenSource | null {
    const historyFile = resolveExecutionHistoryPath(slug);
    if (!fs.existsSync(historyFile)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      const source = ActHistoryCodegenAdapter.fromDocument(raw, slug);
      if (!source.steps.length) return null;
      return source;
    } catch {
      return null;
    }
  }
}
