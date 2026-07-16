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
import {
  bindHealedSelector,
  describeLocator,
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

async function dismissCookieBanner(page: Page): Promise<void> {
  const labels = ['Accept all', 'Accept All', 'Accept', 'I agree', 'Got it', 'OK'];
  for (const label of labels) {
    try {
      const btn = page.getByRole('button', { name: label, exact: false });
      if ((await btn.count()) > 0) {
        await btn.first().click({ timeout: 1_500 });
        return;
      }
    } catch {
      // ignore
    }
  }
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
    return acts.filter((step) => step && step.action);
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
            const locators = stepLocators(step);
            if (!locators.length) {
              throw new Error(`${action} has no locator candidates`);
            }
            let resolved = await resolveUniqueLocator(page, locators, {
              timeoutMs: timeout,
              allowFirst: /\bfirst\b/i.test(step.description || ''),
            });

            if (!resolved && options.heal) {
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
              throw new Error(`no unique visible locator for ${action}`);
            }

            if (action === 'click') {
              await resolved.locator.click({ timeout });
            } else {
              const text = String(step.value ?? '');
              await resolved.locator.fill(text, { timeout });
            }
            stepResult.ok = true;
            stepResult.locatorUsed = resolved.description;
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
