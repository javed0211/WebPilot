import * as fs from 'fs';
import * as path from 'path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import { REPORTS_SCREENSHOTS_DIR, REPORTS_VIDEOS_DIR } from '../ReportPaths';
import type {
  ActHealingRecord,
  ActHistoryDocument,
  ActLocator,
  ActReplayResult,
  ActReplayStepResult,
  ActStep,
} from './ActHistoryTypes';
import { sanitizeActHistoryForReplay, isBadInputLocator } from './ActHistorySanitizer';
import {
  bindHealedSelector,
  bindLocator,
  describeLocator,
  filterLocatorsForAction,
  parseLocatorsFromSelectorJson,
  resolveUniqueLocator,
} from './LocatorResolver';

export interface ActReplayHealHook {
  (args: {
    page: Page;
    step: ActStep;
    brokenDescription: string;
    locators: ActLocator[];
  }): Promise<{ healedSelector: string; confidence: number; reasoning: string; proposalPath?: string } | null>;
}

export interface ActReplayOptions {
  headed?: boolean;
  stepTimeoutMs?: number;
  heal?: ActReplayHealHook | null;
  onStep?: (result: ActReplayStepResult) => void;
  /** off | on | retain-on-failure (default: retain-on-failure) */
  video?: 'off' | 'on' | 'retain-on-failure';
  /** off | on | only-on-failure (default: only-on-failure) */
  screenshots?: 'off' | 'on' | 'only-on-failure';
}

function stepLocators(step: ActStep): ActLocator[] {
  if (step.locators && step.locators.length > 0) return step.locators;
  return parseLocatorsFromSelectorJson(step.selector);
}

function normalizeAction(action: string): string {
  const a = (action || 'custom').toLowerCase();
  if (a === 'fill' || a === 'type') return 'input';
  if (a === 'send_keys') return 'press';
  if (a === 'navigate_back' || a === 'back') return 'go_back';
  return a;
}

async function dismissBookingOverlays(page: Page): Promise<boolean> {
  const dismissors = [
    () => page.getByRole('button', { name: /dismiss sign[\s-]?in/i }),
    () => page.getByLabel(/dismiss sign[\s-]?in/i),
    () => page.locator('[aria-label*="Dismiss sign" i]'),
    () => page.locator('[data-testid="header-sign-in-dismiss"]'),
  ];
  let dismissed = false;
  for (const make of dismissors) {
    try {
      const loc = make().first();
      if ((await loc.count()) === 0) continue;
      if (!(await loc.isVisible().catch(() => false))) continue;
      await loc.click({ timeout: 2_000, force: true });
      await page.waitForTimeout(250);
      dismissed = true;
      break;
    } catch {
      // try next
    }
  }

  // Only Escape when a focus-trap modal is actually present — Escape closes
  // autocomplete suggestions too, which breaks destination selection.
  try {
    const trap = page.locator('[data-bui-trap-root], [role="dialog"]').first();
    if ((await trap.count()) > 0 && (await trap.isVisible().catch(() => false))) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      dismissed = true;
    }
  } catch {
    // ignore
  }
  return dismissed;
}

function isOptionalOverlayClick(step: ActStep, locators: ActLocator[]): boolean {
  const blob = [
    step.description || '',
    ...locators.map((l) => `${l.name || ''} ${l.value || ''} ${l.filterText || ''}`),
  ]
    .join(' ')
    .toLowerCase();
  return /dismiss|sign[\s-]?in|accept|onetrust|cookie|consent|close (dialog|modal|popup|banner)|not now|maybe later|no thanks/i.test(
    blob
  );
}

async function dismissCookieBanner(page: Page): Promise<boolean> {
  await dismissBookingOverlays(page);
  const selectors = [
    '#onetrust-accept-btn-handler',
    'button#onetrust-accept-btn-handler',
    'button.fc-cta-consent',
    '[data-testid="accept-cookies"]',
    'button[data-action="accept-cookies"]',
  ];
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0) {
        await loc.click({ timeout: 2_000 });
        await page.waitForTimeout(300);
        await dismissBookingOverlays(page);
        return true;
      }
    } catch {
      // try next
    }
  }

  const labels = [
    'Accept all',
    'Accept All',
    'Accept',
    'I agree',
    'Agree',
    'Got it',
    'OK',
    'Allow all',
  ];
  for (const label of labels) {
    try {
      const btn = page.getByRole('button', { name: label, exact: false });
      if ((await btn.count()) > 0) {
        await btn.first().click({ timeout: 2_000 });
        await page.waitForTimeout(300);
        await dismissBookingOverlays(page);
        return true;
      }
    } catch {
      // ignore
    }
  }

  // GitHub ghcc-consent and similar shadow/custom banners.
  try {
    const clicked = await page.evaluate(() => {
      const hosts = [
        document.querySelector('ghcc-consent'),
        document.querySelector('#wcpCookiePreferenceCtrl'),
        document.querySelector('.fc-consent-root'),
      ].filter(Boolean) as HTMLElement[];
      for (const host of hosts) {
        const root = (host as any).shadowRoot || host;
        const buttons = root.querySelectorAll?.('button') || [];
        for (const btn of Array.from(buttons) as HTMLButtonElement[]) {
          const t = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
          if (/accept|agree|allow|got it|ok/.test(t)) {
            btn.click();
            return true;
          }
        }
      }
      const ot = document.querySelector('#onetrust-accept-btn-handler') as HTMLElement | null;
      if (ot) {
        ot.click();
        return true;
      }
      return false;
    });
    if (clicked) {
      await page.waitForTimeout(400);
      await dismissBookingOverlays(page);
      return true;
    }
  } catch {
    // ignore
  }
  return dismissBookingOverlays(page);
}

async function clickWithOverlayRecovery(
  page: Page,
  locator: import('playwright').Locator,
  timeout: number
): Promise<void> {
  try {
    await locator.click({ timeout });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/intercepts pointer events|overlay|cookie|consent|trap-root|not stable/i.test(msg)) {
      await dismissCookieBanner(page);
      await dismissBookingOverlays(page);
      try {
        await locator.click({ timeout });
        return;
      } catch {
        // Last resort: force click after Escape (Booking Genius modal).
        await page.keyboard.press('Escape').catch(() => undefined);
        await locator.click({ timeout, force: true });
        return;
      }
    }
    throw err;
  }
}

function isCalendarDateClick(locators: ActLocator[]): boolean {
  const blob = locators.map((l) => `${l.kind}:${l.value}:${l.name}`).join(' ').toLowerCase();
  return (
    (/checkbox|aria-label/.test(blob) && /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(blob)) ||
    /\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/i.test(
      blob
    )
  );
}

function isBadInputTarget(loc: ActLocator): boolean {
  return isBadInputLocator(loc);
}

function formatBookingDateLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

async function ensureDatePickerOpen(page: Page, timeout: number): Promise<void> {
  const already = page.locator('[data-date], [role="checkbox"][aria-label*="202"], span[aria-label*="202"]').first();
  if ((await already.count()) > 0 && (await already.isVisible().catch(() => false))) return;

  const openers = [
    () => page.locator('[data-testid="searchbox-dates-container"]').first(),
    () => page.locator('[data-testid="date-display-field-start"]').first(),
    () => page.getByRole('button', { name: /check-in date|check-out date|select dates/i }),
    () => page.locator('button').filter({ hasText: /check-in|select dates/i }).first(),
  ];
  for (const make of openers) {
    try {
      const loc = make();
      if ((await loc.count()) === 0) continue;
      if (!(await loc.first().isVisible().catch(() => false))) continue;
      await loc.first().click({ timeout: Math.min(timeout, 5_000) });
      await page.waitForTimeout(500);
      const opened = page.locator('[data-date], [role="checkbox"][aria-label*="202"]').first();
      if ((await opened.count()) > 0) return;
    } catch {
      // try next
    }
  }
}

async function clickCalendarDay(page: Page, day: Date, timeout: number): Promise<{
  locator: import('playwright').Locator;
  used: ActLocator;
  description: string;
} | null> {
  const iso = day.toISOString().slice(0, 10);
  const label = formatBookingDateLabel(day);
  const dayNum = String(day.getDate());

  // Navigate months if the target month isn't visible (max 3 next clicks).
  for (let i = 0; i < 3; i++) {
    const monthVisible = await page
      .locator(`[data-date^="${iso.slice(0, 7)}"], [aria-label*="${day.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}"]`)
      .first()
      .isVisible()
      .catch(() => false);
    if (monthVisible) break;
    try {
      await page.getByRole('button', { name: /next month|next/i }).first().click({ timeout: 2_000 });
      await page.waitForTimeout(250);
    } catch {
      break;
    }
  }

  const probes = [
    () => page.locator(`[data-date="${iso}"]`),
    () => page.getByRole('checkbox', { name: label, exact: false }),
    () => page.locator(`span[aria-label="${label}"]`),
    () => page.locator(`[aria-label="${label}"]`),
    () =>
      page
        .locator('[role="checkbox"], td[role="gridcell"] button, span[aria-label]')
        .filter({ hasText: new RegExp(`^${dayNum}$`) })
        .filter({ has: page.locator(`[aria-label*="${day.toLocaleDateString('en-GB', { month: 'long' })}"]`) }),
  ];

  for (const probe of probes) {
    try {
      const loc = probe().first();
      await loc.waitFor({ state: 'visible', timeout: Math.min(timeout, 3_000) });
      return {
        locator: loc,
        used: { kind: 'css', value: `[data-date="${iso}"]`, name: label },
        description: `calendar-date:${iso}`,
      };
    } catch {
      // try next
    }
  }
  return null;
}

async function resolveCalendarDate(
  page: Page,
  locators: ActLocator[],
  timeout: number,
  which: 'checkin' | 'checkout'
): Promise<{ locator: import('playwright').Locator; used: ActLocator; description: string } | null> {
  await ensureDatePickerOpen(page, timeout);

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const checkIn = new Date(today);
  checkIn.setDate(today.getDate() + 7);
  const checkOut = new Date(today);
  checkOut.setDate(today.getDate() + 9);
  const preferred = which === 'checkout' ? checkOut : checkIn;

  // Prefer relative dates (stable across days); then historical labels from ActHistory.
  const historical = locators
    .map((l) => l.name || l.filterText || l.value || '')
    .filter((t) => /\d{4}/.test(t));

  const tryDays = [preferred];
  // If history still has a parseable absolute date within ~60 days, try it too.
  for (const label of historical) {
    const parsed = Date.parse(label.replace(/,/g, ''));
    if (!Number.isNaN(parsed)) {
      const d = new Date(parsed);
      d.setHours(12, 0, 0, 0);
      const diff = Math.abs(d.getTime() - today.getTime()) / 86_400_000;
      if (diff < 60) tryDays.push(d);
    }
  }

  for (const day of tryDays) {
    const hit = await clickCalendarDay(page, day, timeout);
    if (hit) return hit;
  }
  return null;
}


async function tryOptionalOverlayClick(
  page: Page,
  locators: ActLocator[],
  timeout: number
): Promise<{ locator: import('playwright').Locator; used: ActLocator; description: string } | null> {
  for (const loc of locators) {
    try {
      const bound = bindLocator(page, loc);
      if (!bound) continue;
      const target = bound.first();
      const visible = await target.isVisible().catch(() => false);
      if (!visible) continue;
      await target.click({ timeout: Math.min(timeout, 3_000) });
      return {
        locator: target,
        used: loc,
        description: describeLocator(loc),
      };
    } catch {
      // try next
    }
  }
  return null;
}


async function resolveAutocompleteSuggestion(
  page: Page,
  locators: ActLocator[],
  timeout: number
): Promise<{ locator: import('playwright').Locator; used: ActLocator; description: string } | null> {
  const label =
    locators
      .map((l) => l.name || l.filterText || l.value)
      .find((t) => t && /london|united kingdom|,/i.test(String(t))) || '';
  if (!label) return null;
  const city = label.split(',')[0].trim().replace(/\s+Greater\s+.*/i, '').trim() || label;
  const probes = [
    () => page.getByRole('option', { name: label, exact: false }),
    () => page.getByRole('option', { name: city, exact: false }),
    () => page.locator('[role="listbox"] [role="option"]').filter({ hasText: city }),
    () => page.getByRole('button', { name: new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }),
    () =>
      page
        .locator('[data-testid*="autocomplete"] li, [class*="autocomplete"] li')
        .filter({ hasText: city }),
  ];
  for (const probe of probes) {
    try {
      const loc = probe().first();
      await loc.waitFor({ state: 'visible', timeout: Math.min(timeout, 5_000) });
      return {
        locator: loc,
        used: { kind: 'role', value: 'option', name: label },
        description: `autocomplete-option:${label}`,
      };
    } catch {
      // try next
    }
  }
  return null;
}

async function resolveDestinationInput(
  page: Page,
  _text: string,
  timeout: number
): Promise<{ locator: import('playwright').Locator; used: ActLocator; description: string } | null> {
  const probes: Array<() => import('playwright').Locator> = [
    () => page.getByRole('combobox', { name: /where|destination|search/i }),
    () => page.getByPlaceholder(/where|destination|city|search/i),
    () => page.locator('input[name="ss"], input[placeholder*="Where"], input[type="search"]'),
    () => page.getByRole('searchbox'),
  ];
  for (const probe of probes) {
    try {
      const loc = probe().first();
      await loc.waitFor({ state: 'visible', timeout: Math.min(timeout, 5_000) });
      return {
        locator: loc,
        used: { kind: 'role', value: 'combobox', name: 'destination-fallback' },
        description: 'destination-input-fallback',
      };
    } catch {
      // try next
    }
  }
  return null;
}

async function collectPageElements(page: Page): Promise<
  Array<{
    tagName: string;
    text: string;
    placeholder: string;
    selector: string;
    selectorCandidates: Array<{ kind: string; value: string; expression: string }>;
  }>
> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const out: Array<{
      tagName: string;
      text: string;
      placeholder: string;
      selector: string;
      selectorCandidates: Array<{ kind: string; value: string; expression: string }>;
    }> = [];
    for (const el of Array.from(document.querySelectorAll('a,button,input,textarea,select,[role]'))) {
      if (!visible(el)) continue;
      const html = el as HTMLElement;
      const tag = html.tagName.toLowerCase();
      const text = (html.getAttribute('aria-label') || html.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const placeholder = html.getAttribute('placeholder') || '';
      const testid = html.getAttribute('data-testid') || html.getAttribute('data-test') || '';
      const role = html.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : '');
      const candidates: Array<{ kind: string; value: string; expression: string }> = [];
      if (role && text) {
        candidates.push({
          kind: 'role',
          value: `${role}[name='${text}']`,
          expression: `getByRole('${role}', { name: '${text.replace(/'/g, "\\'")}' })`,
        });
      }
      if (placeholder) {
        candidates.push({
          kind: 'placeholder',
          value: placeholder,
          expression: `getByPlaceholder('${placeholder.replace(/'/g, "\\'")}')`,
        });
      }
      if (testid) {
        candidates.push({
          kind: 'testid',
          value: testid,
          expression: `getByTestId('${testid.replace(/'/g, "\\'")}')`,
        });
      }
      const id = html.id ? `#${html.id}` : '';
      out.push({
        tagName: tag,
        text,
        placeholder,
        selector: id || tag,
        selectorCandidates: candidates,
      });
      if (out.length >= 40) break;
    }
    return out;
  });
}

function latestVideoInDir(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(webm|mp4)$/i.test(f))
    .map((f) => path.join(dir, f))
    .filter((p) => {
      try {
        return fs.statSync(p).size >= 10_000;
      } catch {
        return false;
      }
    })
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  return files.length ? files[files.length - 1] : null;
}

export class ActHistoryPlaywrightRunner {
  public static loadSteps(doc: ActHistoryDocument): ActStep[] {
    const acts = doc.actHistory?.length ? doc.actHistory : doc.executionHistory || [];
    const filtered = acts.filter((step) => step && step.action);
    const { steps, dropped, merged } = sanitizeActHistoryForReplay(filtered);
    if (dropped > 0 || merged > 0) {
      console.log(
        `[ActHistory] Sanitized for replay: ${filtered.length} → ${steps.length} steps` +
          (dropped ? ` (dropped ${dropped})` : '') +
          (merged ? ` (merged ${merged} duplicates)` : '')
      );
    }
    return steps;
  }

  public async run(
    slug: string,
    doc: ActHistoryDocument,
    options: ActReplayOptions = {}
  ): Promise<{ result: ActReplayResult; healing: ActHealingRecord[] }> {
    const steps = ActHistoryPlaywrightRunner.loadSteps(doc);
    const stepResults: ActReplayStepResult[] = [];
    const healing: ActHealingRecord[] = [];
    let healedCount = 0;
    const timeout = options.stepTimeoutMs ?? 10_000;
    const videoMode = options.video ?? 'retain-on-failure';
    const screenshotMode = options.screenshots ?? 'only-on-failure';
    const recordVideo = videoMode !== 'off';

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let success = false;
    let failure: string | undefined;
    let videoPath: string | undefined;
    const screenshotPaths: string[] = [];
    const videoTmpDir = path.join(REPORTS_VIDEOS_DIR, `.act-replay-${slug}`);

    try {
      browser = await chromium.launch({
        headless: !options.headed,
        channel: 'chrome',
      });

      if (recordVideo) {
        fs.mkdirSync(videoTmpDir, { recursive: true });
      }

      context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        recordVideo: recordVideo
          ? { dir: videoTmpDir, size: { width: 1280, height: 720 } }
          : undefined,
      });
      const page = await context.newPage();

      for (const step of steps) {
        const action = normalizeAction(step.action);
        const stepResult: ActReplayStepResult = {
          index: step.index,
          action,
          ok: false,
        };

        try {
          if (action === 'navigate') {
            const url = step.value || step.url || step.actionParams?.url;
            if (!url || typeof url !== 'string') throw new Error('navigate missing url');
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.max(timeout, 30_000) });
            await dismissCookieBanner(page);
            stepResult.ok = true;
            stepResult.locatorUsed = url;
          } else if (action === 'go_back') {
            await page.goBack({ waitUntil: 'domcontentloaded', timeout });
            stepResult.ok = true;
          } else if (action === 'wait') {
            const seconds = Number(step.value ?? step.actionParams?.seconds ?? 1);
            await new Promise((r) => setTimeout(r, Math.min(Math.max(seconds, 0.1), 10) * 1000));
            stepResult.ok = true;
          } else if (action === 'press') {
            const key = String(step.value || step.actionParams?.keys || step.actionParams?.key || 'Enter');
            await page.keyboard.press(key);
            stepResult.ok = true;
            stepResult.locatorUsed = key;
          } else if (action === 'scroll') {
            await page.mouse.wheel(0, 800);
            stepResult.ok = true;
          } else if (action === 'screenshot') {
            stepResult.ok = true;
          } else if (action === 'click' || action === 'input') {
            await dismissCookieBanner(page);
            const locators = filterLocatorsForAction(action, stepLocators(step));

            // Optional overlays (sign-in dismiss, cookie accept) — skip quietly when absent.
            if (action === 'click' && isOptionalOverlayClick(step, locators)) {
              const optional = await tryOptionalOverlayClick(page, locators, timeout);
              if (optional) {
                stepResult.ok = true;
                stepResult.locatorUsed = optional.description;
              } else {
                stepResult.ok = true;
                stepResult.locatorUsed = 'skipped:optional-overlay-absent';
              }
            } else {
            let resolved =
              action === 'click' && isCalendarDateClick(locators)
                ? null
                : locators.length > 0
                  ? await resolveUniqueLocator(page, locators, {
                      timeoutMs: Math.min(timeout, 4_000),
                      allowFirst: /\bfirst\b/i.test(step.description || ''),
                      action,
                    })
                  : null;

            // Input with missing/bad history locators: resolve destination/search field by semantics.
            if (action === 'input') {
              const text = String(step.value ?? '');
              if (!resolved || !resolved.used || isBadInputTarget(resolved.used)) {
                const fallback = await resolveDestinationInput(page, text, timeout);
                if (fallback) resolved = fallback;
              }
            }

            // Calendar date cells: open picker and fall back to relative dates (+7 / +9 days).
            if (action === 'click' && isCalendarDateClick(locators)) {
              const priorDateClicks = stepResults.filter(
                (s) => s.ok && /calendar-date/i.test(s.locatorUsed || '')
              ).length;
              const cal = await resolveCalendarDate(
                page,
                locators,
                timeout,
                priorDateClicks > 0 ? 'checkout' : 'checkin'
              );
              if (cal) resolved = cal;
            }

            // Do not LLM-heal calendar dates — heal invents fragile "Select dates…" buttons.
            if (!resolved && options.heal && locators.length && !isCalendarDateClick(locators)) {
              const broken = locators.map(describeLocator).join(' | ');
              const healed = await options.heal({
                page,
                step,
                brokenDescription: broken,
                locators,
              });
              if (healed?.healedSelector) {
                const loc = bindHealedSelector(page, healed.healedSelector);
                await loc.first().waitFor({ state: 'visible', timeout });
                resolved = {
                  locator: loc.first(),
                  used: { kind: 'css', value: healed.healedSelector },
                  description: healed.healedSelector,
                };
                healedCount += 1;
                stepResult.healed = true;
                healing.push({
                  stepIndex: step.index,
                  action,
                  url: page.url(),
                  brokenSelector: broken,
                  healedSelector: healed.healedSelector,
                  confidence: healed.confidence,
                  reasoning: healed.reasoning,
                  proposalPath: healed.proposalPath,
                  at: new Date().toISOString(),
                });
              }
            }

            if (!resolved) {
              if (!locators.length) {
                throw new Error(`${action} has no locator candidates`);
              }
              throw new Error(`no unique visible locator for ${action}`);
            }

            if (action === 'click') {
              let clickTarget = resolved;
              const suggestion = await resolveAutocompleteSuggestion(page, locators, timeout);
              if (suggestion) clickTarget = suggestion;
              await clickWithOverlayRecovery(page, clickTarget.locator, timeout);
            } else {
              const text = String(step.value ?? '');
              await resolved.locator.fill(text, { timeout });
              // Sign-in modal may appear after typing — dismiss button only (no Escape;
              // Escape closes autocomplete suggestions).
              await page.waitForTimeout(400);
              try {
                const dismiss = page.getByRole('button', { name: /dismiss sign[\s-]?in/i }).first();
                if ((await dismiss.count()) > 0 && (await dismiss.isVisible().catch(() => false))) {
                  await dismiss.click({ timeout: 2_000, force: true });
                }
              } catch {
                // ignore
              }
            }
            stepResult.ok = true;
            stepResult.locatorUsed = resolved.description;
            }
          } else if (action === 'search' || action === 'extract' || action === 'find_text' || action === 'evaluate') {
            stepResult.ok = true;
            stepResult.locatorUsed = `skipped:${action}`;
          } else if (action === 'switch' || action === 'close') {
            stepResult.ok = true;
            stepResult.locatorUsed = `skipped:${action}`;
          } else {
            stepResult.ok = true;
            stepResult.locatorUsed = `skipped:${action}`;
          }
        } catch (err) {
          stepResult.ok = false;
          stepResult.error = err instanceof Error ? err.message : String(err);
        }

        if (!stepResult.ok && screenshotMode !== 'off') {
          try {
            const ssDir = path.join(REPORTS_SCREENSHOTS_DIR, slug);
            fs.mkdirSync(ssDir, { recursive: true });
            const ssPath = path.join(ssDir, `failure_step_${step.index}.png`);
            await page.screenshot({ path: ssPath, fullPage: true });
            stepResult.screenshotPath = ssPath;
            screenshotPaths.push(ssPath);
          } catch {
            // ignore screenshot failures
          }
        }

        stepResults.push(stepResult);
        options.onStep?.(stepResult);
        if (!stepResult.ok) {
          failure = `Step ${step.index} [${action}] failed: ${stepResult.error}`;
          break;
        }
      }

      success = !failure;
    } finally {
      // Close context before browser so Playwright flushes the video file.
      if (context) {
        await context.close().catch(() => undefined);
      }
      if (browser) {
        await browser.close().catch(() => undefined);
      }

      if (recordVideo) {
        const recorded = latestVideoInDir(videoTmpDir);
        const keepVideo = videoMode === 'on' || (videoMode === 'retain-on-failure' && !success);
        if (recorded && keepVideo) {
          fs.mkdirSync(REPORTS_VIDEOS_DIR, { recursive: true });
          const ext = path.extname(recorded) || '.webm';
          const dest = path.join(REPORTS_VIDEOS_DIR, `${slug}${ext}`);
          try {
            fs.copyFileSync(recorded, dest);
            if (fs.statSync(dest).size >= 10_000) {
              videoPath = dest;
            }
          } catch {
            // ignore
          }
        }
        try {
          fs.rmSync(videoTmpDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }

    return {
      result: {
        success,
        slug,
        stepsExecuted: stepResults.length,
        stepResults,
        failure,
        healedCount,
        videoPath,
        screenshotPaths: screenshotPaths.length ? screenshotPaths : undefined,
      },
      healing,
    };
  }

  /** Snapshot helpers for heal hook consumers. */
  public static async pageStateForHeal(page: Page): Promise<{
    url: string;
    title: string;
    elements: Awaited<ReturnType<typeof collectPageElements>>;
  }> {
    return {
      url: page.url(),
      title: await page.title(),
      elements: await collectPageElements(page),
    };
  }
}
