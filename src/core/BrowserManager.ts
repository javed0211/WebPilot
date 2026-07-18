import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import type { ExecutionEventLedger } from './events/ExecutionEventLedger';
import { PlaywrightEventCollector } from './events/PlaywrightEventCollector';
import { resolveFeatureFlags } from './lifecycle/FeatureFlags';

export interface InteractiveElement {
  id: number;
  tagName: string;
  text: string;
  type: string;
  placeholder: string;
  ariaLabel: string;
  selector: string;
  selectorCandidates?: { kind: string; value: string; expression: string }[];
  box: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

export interface PageState {
  title: string;
  url: string;
  screenshotBase64: string;
  elements: InteractiveElement[];
}

export interface BrowserManagerLaunchOptions {
  /** Optional event ledger for network/console capture. */
  eventLedger?: ExecutionEventLedger;
  storageStatePath?: string;
}

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private browserTypeStr: string;
  private headless: boolean;
  private viewport: { width: number; height: number };
  private screenshotsOption: string;
  private videoOption: string;
  private traceOption: boolean;
  private eventCollector: PlaywrightEventCollector | null = null;

  constructor(config: {
    browser?: string;
    headless?: boolean;
    viewport?: { width: number; height: number };
    screenshots?: string;
    video?: string;
    trace?: boolean;
  }) {
    this.browserTypeStr = config.browser ?? 'chromium';
    this.headless = config.headless ?? true;
    this.viewport = config.viewport ?? { width: 1280, height: 720 };
    this.screenshotsOption = config.screenshots ?? 'only-on-failure';
    this.videoOption = config.video ?? 'retain-on-failure';
    this.traceOption = config.trace ?? true;
  }

  /**
   * Launches the browser instance and sets up the context and recording settings
   */
  public async launch(options: BrowserManagerLaunchOptions = {}): Promise<Page> {
    const launchOptions: Parameters<typeof chromium.launch>[0] = {
      headless: this.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    };

    // Instantiate correct browser engine
    switch (this.browserTypeStr.toLowerCase()) {
      case 'firefox':
        this.browser = await firefox.launch(launchOptions);
        break;
      case 'webkit':
      case 'edge':
        this.browser = await chromium.launch({ ...launchOptions, channel: 'msedge' });
        break;
      case 'chrome':
        this.browser = await chromium.launch({ ...launchOptions, channel: 'chrome' });
        break;
      case 'chromium':
      default:
        this.browser = await chromium.launch(launchOptions);
        break;
    }

    const recordVideo =
      this.videoOption !== 'off'
        ? {
            dir: path.join(process.cwd(), 'runtime', 'reports', 'videos'),
            size: this.viewport
          }
        : undefined;

    this.context = await this.browser.newContext({
      viewport: this.viewport,
      recordVideo,
      acceptDownloads: true,
      ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
    });

    if (this.traceOption) {
      await this.context.tracing.start({ screenshots: true, snapshots: true });
    }

    this.page = await this.context.newPage();

    if (options.eventLedger) {
      const flags = resolveFeatureFlags();
      this.eventCollector = new PlaywrightEventCollector({
        ledger: options.eventLedger,
        networkMode: flags.captureNetwork,
        consoleMode: flags.captureConsole,
      });
      this.eventCollector.attach(this.page);
      options.eventLedger.appendLifecycle('browser.launched', 'passed', {
        browser: this.browserTypeStr,
        headless: this.headless,
      });
    }

    return this.page;
  }

  public getActivePage(): Page {
    if (!this.page) throw new Error('Browser is not launched yet.');
    return this.page;
  }

  public getActiveContext(): BrowserContext {
    if (!this.context) throw new Error('Browser Context is not launched yet.');
    return this.context;
  }

  /**
   * Closes browser context and handles trace/video persistence
   */
  public async close(testName: string, success: boolean): Promise<void> {
    try {
      this.eventCollector?.detach();
      this.eventCollector = null;

      if (this.context && this.traceOption) {
        const tracePath = path.join(process.cwd(), 'runtime', 'reports', 'traces', `${testName.replace(/\s+/g, '_')}_trace.zip`);
        fs.mkdirSync(path.dirname(tracePath), { recursive: true });
        await this.context.tracing.stop({ path: tracePath });
      }

      if (this.context) {
        await this.context.close();
      }
      if (this.browser) {
        await this.browser.close();
      }
    } catch (err) {
      console.error('Error closing browser manager:', err);
    } finally {
      this.page = null;
      this.context = null;
      this.browser = null;
    }
  }

  /**
   * Captures visual details, viewport screenshot and extracts the interactive element tree
   */
  public async getPageState(): Promise<PageState> {
    const page = this.getActivePage();
    
    // Capture screenshot
    const screenshotBuffer = await page.screenshot({ type: 'png' });
    const screenshotBase64 = screenshotBuffer.toString('base64');

    // Deep DOM Discovery Script to identify all focusable and interactive items
    const elements = await page.evaluate(() => {
      const interactiveSelectors = [
        'button', 'a', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
        '[contenteditable="true"]', '.btn', '.button', 'a *', 'button *',
        'i', 'svg', '[class*="icon"]', '[class*="settings"]', '.top-settings'
      ];
      
      const elementsList: any[] = [];
      const allElements = document.querySelectorAll(interactiveSelectors.join(','));
      
      let elementId = 1;
      
      allElements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        
        // Filter out hidden or completely collapsed items
        const isVisible = rect.width > 0 && rect.height > 0 && 
                          window.getComputedStyle(el).display !== 'none' && 
                          window.getComputedStyle(el).visibility !== 'hidden';
                          
        if (!isVisible) return;

        const textSnippet = el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || '';
        const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const testId =
          el.getAttribute('data-testid') ||
          el.getAttribute('data-test') ||
          el.getAttribute('data-qa') ||
          '';
        const role =
          el.getAttribute('role') ||
          (el.tagName.toLowerCase() === 'a'
            ? 'link'
            : el.tagName.toLowerCase() === 'button' || el.getAttribute('type') === 'button'
              ? 'button'
              : '');

        const candidates: any[] = [];
        if (role && (ariaLabel || textSnippet)) {
          candidates.push({
            kind: 'role',
            value: `${role}[name='${ariaLabel || textSnippet}']`,
            expression: `page.getByRole('${role}', { name: '${(ariaLabel || textSnippet).replace(/'/g, "\\'")}' })`,
          });
        }
        if (placeholder) {
          candidates.push({
            kind: 'placeholder',
            value: placeholder,
            expression: `page.getByPlaceholder('${placeholder.replace(/'/g, "\\'")}')`,
          });
        }
        if (testId) {
          candidates.push({
            kind: 'testid',
            value: testId,
            expression: `page.getByTestId('${testId.replace(/'/g, "\\'")}')`,
          });
        }
        if (textSnippet && textSnippet.length <= 60) {
          candidates.push({
            kind: 'text',
            value: textSnippet,
            expression: `page.getByText('${textSnippet.replace(/'/g, "\\'")}')`,
          });
        }

        // Generate robust CSS selectors
        let selector = '';
        if (el.id) {
          selector = `#${el.id}`;
        } else if (el.tagName.toLowerCase() === 'input' && el.getAttribute('name')) {
          selector = `input[name="${el.getAttribute('name')}"]`;
        } else if (el.tagName.toLowerCase() === 'input' && el.getAttribute('placeholder')) {
          selector = `input[placeholder="${el.getAttribute('placeholder')}"]`;
        } else {
          // Generate general css selector path
          const tagName = el.tagName.toLowerCase();
          const classList = Array.from(el.classList).filter(c => !c.includes(':')).join('.');
          selector = tagName + (classList ? `.${classList}` : '');
          
          // Make unique by appending inner text if available
          const shortText = textSnippet.slice(0, 15);
          if (shortText && tagName === 'button') {
            selector = `button:has-text("${shortText}")`;
          }
        }
        if (selector) {
          candidates.push({
            kind: selector.startsWith('//') ? 'xpath' : 'css',
            value: selector,
            expression: `page.locator('${selector.replace(/'/g, "\\'")}')`,
          });
        }

        // Clean up element details
        elementsList.push({
          id: elementId++,
          tagName: el.tagName.toLowerCase(),
          text: textSnippet.slice(0, 50),
          type: el.getAttribute('type') || '',
          placeholder,
          ariaLabel,
          selector: selector,
          selectorCandidates: candidates,
          box: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          visible: true
        });
      });
      
      return elementsList as any[];
    });

    return {
      title: await page.title(),
      url: page.url(),
      screenshotBase64,
      elements
    };
  }
}
