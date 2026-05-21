import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

export interface InteractiveElement {
  id: number;
  tagName: string;
  text: string;
  type: string;
  placeholder: string;
  ariaLabel: string;
  selector: string;
  box: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

export interface PageState {
  title: string;
  url: string;
  screenshotBase64: string;
  elements: InteractiveElement[];
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
  public async launch(): Promise<Page> {
    const launchOptions = {
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
      case 'chrome':
      case 'chromium':
      default:
        this.browser = await chromium.launch(launchOptions);
        break;
    }

    const recordVideo =
      this.videoOption !== 'off'
        ? {
            dir: path.join(process.cwd(), 'reports', 'videos'),
            size: this.viewport
          }
        : undefined;

    this.context = await this.browser.newContext({
      viewport: this.viewport,
      recordVideo,
      acceptDownloads: true
    });

    if (this.traceOption) {
      await this.context.tracing.start({ screenshots: true, snapshots: true });
    }

    this.page = await this.context.newPage();
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
      if (this.context && this.traceOption) {
        const tracePath = path.join(process.cwd(), 'reports', 'traces', `${testName.replace(/\s+/g, '_')}_trace.zip`);
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
          const textSnippet = el.textContent?.trim().slice(0, 15);
          if (textSnippet && tagName === 'button') {
            selector = `button:has-text("${textSnippet}")`;
          }
        }

        // Clean up element details
        elementsList.push({
          id: elementId++,
          tagName: el.tagName.toLowerCase(),
          text: el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 50) || '',
          type: el.getAttribute('type') || '',
          placeholder: el.getAttribute('placeholder') || '',
          ariaLabel: el.getAttribute('aria-label') || el.getAttribute('title') || '',
          selector: selector,
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
