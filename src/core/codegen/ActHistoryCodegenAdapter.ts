import * as fs from 'fs';
import { resolveExecutionHistoryPath } from '../ReportPaths';
import { RawExecutionStep } from './ExecutionTrace';
import { filterActHistoryForCodegen } from './ActHistoryCodegenFilter';
import { sanitizeActHistoryForReplay } from '../replay/ActHistorySanitizer';
import { Logger } from '../../utils/Logger';
import {
  compactWorkflowToActSteps,
  formatCompactCoverageLog,
  getCompactWorkflow,
} from './CompactWorkflow';
import type { CompactWorkflow } from '../replay/ActHistoryTypes';

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
  compactWorkflow?: CompactWorkflow;
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
  urlHint?: string,
  finalUrl?: string
): RawExecutionStep[] {
  const steps: RawExecutionStep[] = [];
  const finalHost = (() => {
    try {
      return finalUrl ? new URL(finalUrl).hostname.toLowerCase() : '';
    } catch {
      return '';
    }
  })();

  /** Token from the NL assert that truthfully appears in the final URL (excluding the domain). */
  const urlTokenFor = (nl: string): string | null => {
    if (!finalUrl) return null;
    const lowerUrl = finalUrl.toLowerCase();
    const tokens = nl
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 5 && !/^(verify|assert|check|ensure|visible|displayed|shown|present|loaded|page|results?)$/i.test(t));
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (finalHost.includes(lower)) continue; // domain match is trivially true
      if (lowerUrl.includes(lower)) return token;
    }
    return null;
  };

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

    // Brand/logo asserts: "Verify the Booking.com logo…" → assert the brand link,
    // not the literal sentence (which never exists as page text).
    const brandWord = nl.match(/([A-Z][a-zA-Z0-9]*\.(?:com|org|net|io))/)?.[1];
    if (brandWord && /\blogo\b/i.test(nl) && finalHost.includes(brandWord.split('.')[0].toLowerCase())) {
      steps.push({
        index: steps.length + 1,
        action: 'assert',
        description: nl,
        value: brandWord,
        selector: JSON.stringify([{ kind: 'role', value: 'link', name: brandWord }]),
        url: urlHint || null,
      });
      continue;
    }

    // Ground multi-clause / page-state asserts against the observed final URL.
    // "Verify the search results page is displayed" has no literal page text, but
    // the final URL truthfully contains "search"; assert that instead.
    const looksLikePageStateAssert =
      !text || text.length > 40 || / and /i.test(nl) || /\bpage\b/i.test(nl);
    if (looksLikePageStateAssert) {
      const token = urlTokenFor(nl);
      if (token) {
        steps.push({
          index: steps.length + 1,
          action: 'assert',
          description: nl,
          value: `__url_contains__:${token}`,
          url: finalUrl || urlHint || null,
        });
        continue;
      }
    }

    // Plain verify-text must use getByText — never invent role:link (flaky for body copy).
    const locators = text
      ? [
          { kind: 'text', value: text },
          ...(/\bheading\b/i.test(nl)
            ? [{ kind: 'role', value: 'heading', name: text }]
            : []),
        ]
      : [];
    const isHomeAssert = /\bhomepage\b|\bhome page\b|search wikipedia/i.test(nl);
    steps.push({
      index: steps.length + 1,
      action: 'assert',
      description: nl,
      value: text,
      selector: locators.length ? JSON.stringify(locators) : null,
      // Stamp the page where the verify belongs so POM mapping does not collapse
      // every trailing assertionPlan item onto the entry URL.
      url: isHomeAssert ? urlHint || null : finalUrl || urlHint || null,
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
    urlBefore: step.urlBefore ?? null,
    urlAfter: step.urlAfter ?? null,
    description: String(step.description || `${step.action || 'step'} ${index + 1}`),
    locators: Array.isArray(step.locators) ? step.locators : undefined,
  };
}

/** Backfill urlBefore/urlAfter from surrounding steps so page mapping keeps context. */
function backfillStepUrls(steps: RawExecutionStep[]): void {
  let lastKnown: string | null = null;
  for (const step of steps) {
    if (!step.urlBefore) step.urlBefore = lastKnown;
    if (step.url) lastKnown = step.url;
  }
  let nextKnown: string | null = null;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (!steps[i].urlAfter) steps[i].urlAfter = steps[i].url ?? nextKnown;
    if (steps[i].url) nextKnown = steps[i].url ?? nextKnown;
    else if (steps[i].urlBefore) nextKnown = steps[i].urlBefore ?? nextKnown;
  }
}

/**
 * Build codegen input steps from compactWorkflow (preferred) or ActHistory (+ assertionPlan).
 * Full actHistory remains audit; compactWorkflow is the source of truth when present.
 */
export class ActHistoryCodegenAdapter {
  public static fromDocument(raw: any, slug: string): ActHistoryCodegenSource {
    const assertionPlan = (raw.assertionPlan || []) as AssertionPlanItem[];
    const nlSteps = Array.isArray(raw.nlSteps) ? raw.nlSteps : [];
    const compact = getCompactWorkflow(raw);

    if (compact?.steps?.length) {
      const compactActs = compactWorkflowToActSteps(compact);
      // Compact already includes assertionPlan rows from Python builder; avoid double-append
      // when those asserts are present. Still merge any missing asserts from assertionPlan.
      const hasAssert = compactActs.some((s) =>
        ['assert', 'screenshot'].includes(String(s.action || '').toLowerCase())
      );
      const firstUrl =
        compactActs.find((s) => s.action === 'navigate' && s.url)?.url ||
        compactActs.find((s) => s.url)?.url ||
        undefined;
      const finalUrl = [...compactActs].reverse().find((s) => s.url)?.url || undefined;
      let merged: RawExecutionStep[] = compactActs.map((step, i) => normalizeActStep(step, i));
      if (!hasAssert && assertionPlan.length) {
        const assertSteps = assertionPlanToSteps(assertionPlan, firstUrl || undefined, finalUrl);
        merged = [...merged, ...assertSteps].map((step, i) => ({ ...step, index: i + 1 }));
      }
      // Light filter only — do not re-run aggressive sanitize merge (preserves loops).
      const filtered = filterActHistoryForCodegen(merged);
      if (filtered.dropped > 0) {
        Logger.detail(
          `Compact workflow codegen filter: dropped ${filtered.dropped} noise step(s)`
        );
      }
      const logLine = formatCompactCoverageLog(compact);
      if (logLine) Logger.detail(logLine);
      backfillStepUrls(filtered.steps);
      return {
        scenario: raw.scenario || raw.testName || slug,
        scenarioSlug: slug,
        sourceFile: raw.sourceFile,
        historySource: compact.source || 'browser-use-compact',
        steps: filtered.steps,
        assertionPlan,
        nlSteps,
        targetUrl: firstUrl || undefined,
        compactWorkflow: compact,
      };
    }

    const actSteps = (raw.actHistory || []) as any[];
    const legacySteps = (raw.executionHistory || raw.steps || []) as any[];
    const sourceSteps = actSteps.length ? actSteps : legacySteps;
    const acts = sourceSteps.map((step, i) => normalizeActStep(step, i));

    const firstUrl =
      acts.find((s) => s.action === 'navigate' && s.url)?.url ||
      acts.find((s) => s.url)?.url ||
      undefined;
    const finalUrl = [...acts].reverse().find((s) => s.url)?.url || undefined;
    const assertSteps = assertionPlanToSteps(assertionPlan, firstUrl || undefined, finalUrl);

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
          ` replay sanitize: ${filtered.steps.length} → ${sanitized.steps.length}` +
          (sanitized.dropped ? ` (dropped ${sanitized.dropped})` : '') +
          (sanitized.merged ? ` (merged ${sanitized.merged})` : '')
      );
    }
    const merged = sanitized.steps as RawExecutionStep[];
    backfillStepUrls(merged);

    return {
      scenario: raw.scenario || raw.testName || slug,
      scenarioSlug: slug,
      sourceFile: raw.sourceFile,
      historySource: raw.historySource || (actSteps.length ? 'browser-use-act-history' : 'legacy'),
      steps: merged,
      assertionPlan,
      nlSteps,
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
