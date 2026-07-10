import {
  Page,
  Locator,
  expect,
  type BrowserContext,
  type Dialog,
  type Download,
  type PageScreenshotOptions,
  type LocatorScreenshotOptions,
} from '@playwright/test';

/** Default timeout (ms) for waits and actions when not specified. */
export const BASE_PAGE_DEFAULT_TIMEOUT = 10_000;

type Target = string | Locator;
type Role = Parameters<Page['getByRole']>[0];
type RoleOptions = Parameters<Page['getByRole']>[1];

/**
 * BasePage — Playwright Page/Locator API surface for all Page Objects.
 * Prefer semantic locators + scoped Locators; use string selectors when needed.
 * Subclasses may use `this.page` for advanced cases not wrapped here.
 */
export class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Resolve CSS/XPath string or pass through an existing Locator. */
  protected resolveLocator(target: Target): Locator {
    return typeof target === 'string' ? this.page.locator(target) : target;
  }

  protected async waitVisible(target: Target, timeout = BASE_PAGE_DEFAULT_TIMEOUT): Promise<Locator> {
    const locator = this.resolveLocator(target);
    await locator.waitFor({ state: 'visible', timeout });
    return locator;
  }

  // ---------------------------------------------------------------------------
  // Page access
  // ---------------------------------------------------------------------------

  public getPage(): Page {
    return this.page;
  }

  public getContext() {
    return this.page.context();
  }

  public url(): string {
    return this.page.url();
  }

  public title(): Promise<string> {
    return this.page.title();
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  public async navigate(
    url: string,
    options?: Parameters<Page['goto']>[1]
  ): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', ...options });
  }

  public async reload(options?: Parameters<Page['reload']>[0]): Promise<void> {
    await this.page.reload(options);
  }

  public async goBack(options?: Parameters<Page['goBack']>[0]): Promise<void> {
    await this.page.goBack(options);
  }

  public async goForward(options?: Parameters<Page['goForward']>[0]): Promise<void> {
    await this.page.goForward(options);
  }

  // ---------------------------------------------------------------------------
  // Tabs & windows (each browser tab is a separate Playwright Page)
  // ---------------------------------------------------------------------------

  /** Point this POM at another tab so subsequent actions use that page. */
  protected setActivePage(page: Page): void {
    this.page = page;
  }

  /** Open a new browser tab and navigate (does not switch this POM unless you call switchToTab). */
  public async openNewTab(
    url: string,
    options?: Parameters<Page['goto']>[1]
  ): Promise<Page> {
    const newPage = await this.page.context().newPage();
    await newPage.goto(url, { waitUntil: 'domcontentloaded', ...options });
    return newPage;
  }

  /**
   * Click a link/button so it opens in a new tab (Cmd+click / Ctrl+click).
   * Returns the new Page; use switchToTab or setActivePage to continue on it.
   */
  public async openInNewTab(
    target: Target,
    options?: Parameters<Locator['click']>[0]
  ): Promise<Page> {
    const [newPage] = await Promise.all([
      this.page.context().waitForEvent('page'),
      this.resolveLocator(target).click({
        ...options,
        modifiers: ['ControlOrMeta', ...(options?.modifiers ?? [])],
      }),
    ]);
    await newPage.waitForLoadState('domcontentloaded');
    return newPage;
  }

  /** All open tabs in this browser context. */
  public getOpenTabs(): Page[] {
    return this.page.context().pages();
  }

  public getActiveTabIndex(): number {
    return this.getOpenTabs().indexOf(this.page);
  }

  /** Switch this POM to tab by index (0 = first tab) and bring it to front. */
  public async switchToTab(index: number): Promise<Page> {
    const pages = this.getOpenTabs();
    if (index < 0 || index >= pages.length) {
      throw new Error(`Tab index ${index} is out of range (0–${pages.length - 1})`);
    }
    this.page = pages[index];
    await this.page.bringToFront();
    return this.page;
  }

  /** Switch to the first tab whose URL contains or matches the pattern. */
  public async switchToTabByUrl(url: string | RegExp): Promise<Page> {
    const pages = this.getOpenTabs();
    const found = pages.find((p) => {
      const u = p.url();
      return typeof url === 'string' ? u.includes(url) : url.test(u);
    });
    if (!found) {
      throw new Error(
        `No open tab matching URL ${String(url)}. Open tabs: ${pages.map((p) => p.url()).join(', ')}`
      );
    }
    this.page = found;
    await this.page.bringToFront();
    return this.page;
  }

  /** Focus current tab (no index change). */
  public async bringTabToFront(): Promise<void> {
    await this.page.bringToFront();
  }

  /** Close a tab; defaults to current. Switches to first remaining tab if current was closed. */
  public async closeTab(tab?: Page): Promise<void> {
    const target = tab ?? this.page;
    const pages = this.getOpenTabs();
    if (pages.length <= 1) {
      throw new Error('Cannot close the only open tab');
    }
    const closingCurrent = target === this.page;
    await target.close();
    if (closingCurrent) {
      const remaining = this.getOpenTabs();
      this.page = remaining[0];
      await this.page.bringToFront();
    }
  }

  /**
   * Run work on another tab, then restore the tab this POM had before.
   * Prefer this over bare `switchToTab` so you do not leave `this.page` on the wrong tab.
   */
  public async withTab<T>(index: number, fn: (tab: Page) => Promise<T>): Promise<T> {
    const previous = this.page;
    const tab = await this.switchToTab(index);
    try {
      return await fn(tab);
    } finally {
      this.page = previous;
      await this.page.bringToFront();
    }
  }

  /** Same as `withTab`, matched by URL. */
  public async withTabByUrl<T>(
    url: string | RegExp,
    fn: (tab: Page) => Promise<T>
  ): Promise<T> {
    const previous = this.page;
    const tab = await this.switchToTabByUrl(url);
    try {
      return await fn(tab);
    } finally {
      this.page = previous;
      await this.page.bringToFront();
    }
  }

  // ---------------------------------------------------------------------------
  // Semantic locator factories (preferred)
  // ---------------------------------------------------------------------------

  public locator(selector: string): Locator {
    return this.page.locator(selector);
  }

  public getByRole(role: Role, options?: RoleOptions): Locator {
    return this.page.getByRole(role, options);
  }

  public getByLabel(text: string | RegExp, options?: { exact?: boolean }): Locator {
    return this.page.getByLabel(text, options);
  }

  public getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }): Locator {
    return this.page.getByPlaceholder(text, options);
  }

  public getByText(text: string | RegExp, options?: { exact?: boolean }): Locator {
    return this.page.getByText(text, options);
  }

  public getByAltText(text: string | RegExp, options?: { exact?: boolean }): Locator {
    return this.page.getByAltText(text, options);
  }

  public getByTitle(text: string | RegExp, options?: { exact?: boolean }): Locator {
    return this.page.getByTitle(text, options);
  }

  public getByTestId(testId: string | RegExp): Locator {
    return this.page.getByTestId(testId);
  }

  public frameLocator(selector: string) {
    return this.page.frameLocator(selector);
  }

  // ---------------------------------------------------------------------------
  // Locator interactions
  // ---------------------------------------------------------------------------

  public async click(target: Target, options?: Parameters<Locator['click']>[0]): Promise<void> {
    await this.waitVisible(target);
    await this.resolveLocator(target).click(options);
  }

  public async clickByRole(role: Role, options?: RoleOptions): Promise<void> {
    await this.getByRole(role, options).click();
  }

  public async doubleClick(target: Target, options?: Parameters<Locator['dblclick']>[0]): Promise<void> {
    await this.waitVisible(target);
    await this.resolveLocator(target).dblclick(options);
  }

  public async fill(
    target: Target,
    value: string,
    options?: Parameters<Locator['fill']>[1]
  ): Promise<void> {
    await this.waitVisible(target);
    await this.resolveLocator(target).fill(value, options);
  }

  public async fillByLabel(label: string | RegExp, value: string): Promise<void> {
    await this.getByLabel(label).fill(value);
  }

  public async fillByPlaceholder(placeholder: string | RegExp, value: string): Promise<void> {
    await this.getByPlaceholder(placeholder).fill(value);
  }

  public async clear(target: Target, options?: Parameters<Locator['clear']>[0]): Promise<void> {
    await this.resolveLocator(target).clear(options);
  }

  public async type(
    target: Target,
    text: string,
    options?: Parameters<Locator['pressSequentially']>[1]
  ): Promise<void> {
    await this.waitVisible(target);
    await this.resolveLocator(target).pressSequentially(text, options);
  }

  public async press(target: Target, key: string, options?: Parameters<Locator['press']>[1]): Promise<void> {
    await this.waitVisible(target);
    await this.resolveLocator(target).press(key, options);
  }

  public async pressPage(key: string, options?: Parameters<Page['keyboard']['press']>[1]): Promise<void> {
    await this.page.keyboard.press(key, options);
  }

  public async check(target: Target, options?: Parameters<Locator['check']>[0]): Promise<void> {
    await this.resolveLocator(target).check(options);
  }

  public async uncheck(target: Target, options?: Parameters<Locator['uncheck']>[0]): Promise<void> {
    await this.resolveLocator(target).uncheck(options);
  }

  public async setChecked(
    target: Target,
    checked: boolean,
    options?: Parameters<Locator['setChecked']>[1]
  ): Promise<void> {
    await this.resolveLocator(target).setChecked(checked, options);
  }

  public async selectOption(
    target: Target,
    values: Parameters<Locator['selectOption']>[0],
    options?: Parameters<Locator['selectOption']>[1]
  ): Promise<void> {
    await this.waitVisible(target);
    await this.resolveLocator(target).selectOption(values, options);
  }

  public async setInputFiles(
    target: Target,
    files: Parameters<Locator['setInputFiles']>[0],
    options?: Parameters<Locator['setInputFiles']>[1]
  ): Promise<void> {
    await this.resolveLocator(target).setInputFiles(files, options);
  }

  public async hover(target: Target, options?: Parameters<Locator['hover']>[0]): Promise<void> {
    await this.waitVisible(target);
    await this.resolveLocator(target).hover(options);
  }

  public async focus(target: Target, options?: Parameters<Locator['focus']>[0]): Promise<void> {
    await this.resolveLocator(target).focus(options);
  }

  public async blur(target: Target, options?: Parameters<Locator['blur']>[0]): Promise<void> {
    await this.resolveLocator(target).blur(options);
  }

  public async tap(target: Target, options?: Parameters<Locator['tap']>[0]): Promise<void> {
    await this.resolveLocator(target).tap(options);
  }

  public async scrollIntoView(target: Target, timeout = BASE_PAGE_DEFAULT_TIMEOUT): Promise<void> {
    const locator = this.resolveLocator(target);
    await locator.waitFor({ state: 'attached', timeout });
    await locator.scrollIntoViewIfNeeded();
  }

  /** Mouse wheel scroll at current cursor position (or page center). */
  public async scrollWheel(deltaX: number, deltaY: number): Promise<void> {
    await this.page.mouse.wheel(deltaX, deltaY);
  }

  /** Window scroll via `window.scrollBy`. */
  public async scrollPageBy(x: number, y: number): Promise<void> {
    await this.page.evaluate(({ dx, dy }) => window.scrollBy(dx, dy), { dx: x, dy: y });
  }

  public async scrollToTop(): Promise<void> {
    await this.page.evaluate(() => window.scrollTo(0, 0));
  }

  public async scrollToBottom(): Promise<void> {
    await this.page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight)
    );
  }

  /** Scroll the page up/down/left/right by pixel amount (mouse wheel). */
  public async scrollPage(
    direction: 'up' | 'down' | 'left' | 'right',
    amount = 400
  ): Promise<void> {
    const deltas: Record<string, [number, number]> = {
      up: [0, -amount],
      down: [0, amount],
      left: [-amount, 0],
      right: [amount, 0],
    };
    const [dx, dy] = deltas[direction];
    await this.scrollWheel(dx, dy);
  }

  /** Scroll within a scrollable element (not the main window). */
  public async scrollLocator(
    target: Target,
    options?: { x?: number; y?: number; toTop?: boolean; toBottom?: boolean }
  ): Promise<void> {
    const locator = this.resolveLocator(target);
    await locator.evaluate(
      (el, opts) => {
        const node = el as HTMLElement;
        if (opts.toTop) {
          node.scrollTop = 0;
          return;
        }
        if (opts.toBottom) {
          node.scrollTop = node.scrollHeight;
          return;
        }
        node.scrollBy(opts.x ?? 0, opts.y ?? 0);
      },
      { x: options?.x ?? 0, y: options?.y ?? 0, toTop: options?.toTop, toBottom: options?.toBottom }
    );
  }

  public async dragTo(
    source: Target,
    target: Target,
    options?: Parameters<Locator['dragTo']>[1]
  ): Promise<void> {
    await this.resolveLocator(source).dragTo(this.resolveLocator(target), options);
  }

  // ---------------------------------------------------------------------------
  // Locator reads & state
  // ---------------------------------------------------------------------------

  public async getText(target: Target, timeout = BASE_PAGE_DEFAULT_TIMEOUT): Promise<string> {
    const locator = await this.waitVisible(target, timeout);
    return (await locator.innerText()).trim();
  }

  public async textContent(target: Target): Promise<string | null> {
    return this.resolveLocator(target).textContent();
  }

  public async inputValue(target: Target): Promise<string> {
    return this.resolveLocator(target).inputValue();
  }

  public async getAttribute(target: Target, name: string): Promise<string | null> {
    return this.resolveLocator(target).getAttribute(name);
  }

  public async count(target: Target): Promise<number> {
    return this.resolveLocator(target).count();
  }

  public async isVisible(target: Target, timeout = 5000): Promise<boolean> {
    try {
      await this.resolveLocator(target).waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  public async isHidden(target: Target, timeout?: number): Promise<boolean> {
    return this.resolveLocator(target).isHidden({ timeout });
  }

  public async isEnabled(target: Target, options?: { timeout?: number }): Promise<boolean> {
    return this.resolveLocator(target).isEnabled(options);
  }

  public async isDisabled(target: Target, options?: { timeout?: number }): Promise<boolean> {
    return this.resolveLocator(target).isDisabled(options);
  }

  public async isChecked(target: Target, options?: { timeout?: number }): Promise<boolean> {
    return this.resolveLocator(target).isChecked(options);
  }

  public async isEditable(target: Target, options?: { timeout?: number }): Promise<boolean> {
    return this.resolveLocator(target).isEditable(options);
  }

  public async boundingBox(target: Target) {
    return this.resolveLocator(target).boundingBox();
  }

  // ---------------------------------------------------------------------------
  // Waits
  // ---------------------------------------------------------------------------

  public async waitForLocator(
    target: Target,
    options?: Parameters<Locator['waitFor']>[0]
  ): Promise<void> {
    await this.resolveLocator(target).waitFor(options);
  }

  public async waitForURL(
    url: string | RegExp | ((url: URL) => boolean),
    options?: Parameters<Page['waitForURL']>[1]
  ): Promise<void> {
    await this.page.waitForURL(url, options);
  }

  public async waitForLoadState(
    state?: Parameters<Page['waitForLoadState']>[0],
    options?: Parameters<Page['waitForLoadState']>[1]
  ): Promise<void> {
    await this.page.waitForLoadState(state ?? 'load', options);
  }

  public async waitForTimeout(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  public async waitForFunction<R>(
    pageFunction: Parameters<Page['waitForFunction']>[0],
    arg?: Parameters<Page['waitForFunction']>[1],
    options?: Parameters<Page['waitForFunction']>[2]
  ): Promise<R> {
    return this.page.waitForFunction(pageFunction, arg, options) as Promise<R>;
  }

  public waitForResponse(
    urlOrPredicate: Parameters<Page['waitForResponse']>[0],
    options?: Parameters<Page['waitForResponse']>[1]
  ) {
    return this.page.waitForResponse(urlOrPredicate, options);
  }

  public waitForRequest(
    urlOrPredicate: Parameters<Page['waitForRequest']>[0],
    options?: Parameters<Page['waitForRequest']>[1]
  ) {
    return this.page.waitForRequest(urlOrPredicate, options);
  }

  public waitForEvent(event: Parameters<Page['waitForEvent']>[0], options?: Parameters<Page['waitForEvent']>[1]) {
    return this.page.waitForEvent(event, options);
  }

  // ---------------------------------------------------------------------------
  // Dialogs, downloads, popups
  // ---------------------------------------------------------------------------

  public onDialog(handler: (dialog: Dialog) => void | Promise<void>): void {
    this.page.on('dialog', handler);
  }

  public onceDialog(handler: (dialog: Dialog) => void | Promise<void>): void {
    this.page.once('dialog', handler);
  }

  public async acceptNextDialog(promptText?: string): Promise<void> {
    this.page.once('dialog', (dialog) => {
      void dialog.accept(promptText);
    });
  }

  public async dismissNextDialog(): Promise<void> {
    this.page.once('dialog', (dialog) => {
      void dialog.dismiss();
    });
  }

  public async waitForDownload(options?: { timeout?: number }): Promise<Download> {
    return this.page.waitForEvent('download', options);
  }

  /**
   * Wait for a popup tab. Pass an action to run in parallel (click that opens `window.open` / `_blank`).
   * Without an action, waits for the next popup only.
   */
  public async waitForPopup(
    actionOrOptions?: (() => Promise<void>) | { timeout?: number }
  ): Promise<Page> {
    if (typeof actionOrOptions === 'function') {
      const [popup] = await Promise.all([
        this.page.waitForEvent('popup'),
        actionOrOptions(),
      ]);
      await popup.waitForLoadState('domcontentloaded');
      return popup;
    }
    return this.page.waitForEvent('popup', actionOrOptions);
  }

  // ---------------------------------------------------------------------------
  // Scripts & frames
  // ---------------------------------------------------------------------------

  public async evaluate<R>(
    pageFunction: Parameters<Page['evaluate']>[0],
    arg?: Parameters<Page['evaluate']>[1]
  ): Promise<R> {
    return this.page.evaluate(pageFunction, arg) as Promise<R>;
  }

  public async evaluateHandle(
    pageFunction: Parameters<Page['evaluateHandle']>[0],
    arg?: Parameters<Page['evaluateHandle']>[1]
  ) {
    return this.page.evaluateHandle(pageFunction, arg);
  }

  public async addInitScript(
    script: Parameters<Page['addInitScript']>[0],
    arg?: Parameters<Page['addInitScript']>[1]
  ): Promise<void> {
    await this.page.addInitScript(script, arg);
  }

  public mainFrame() {
    return this.page.mainFrame();
  }

  public frames() {
    return this.page.frames();
  }

  // ---------------------------------------------------------------------------
  // Zoom (browser chrome zoom — best-effort; CSS zoom + keyboard shortcuts)
  // ---------------------------------------------------------------------------

  /**
   * Set page zoom via CSS `zoom` on documentElement (Chromium/WebKit; may not match browser UI zoom).
   * @param percent 100 = normal, 150 = 150%
   */
  public async setZoomPercent(percent: number): Promise<void> {
    const scale = percent / 100;
    await this.page.evaluate((s) => {
      document.documentElement.style.zoom = String(s);
    }, scale);
  }

  public async resetZoom(): Promise<void> {
    await this.setZoomPercent(100);
  }

  /** Browser zoom in (Ctrl/Cmd +). Repeat `times` for multiple steps. */
  public async zoomIn(times = 1): Promise<void> {
    for (let i = 0; i < times; i++) {
      await this.page.keyboard.press('ControlOrMeta+=');
    }
  }

  /** Browser zoom out (Ctrl/Cmd -). */
  public async zoomOut(times = 1): Promise<void> {
    for (let i = 0; i < times; i++) {
      await this.page.keyboard.press('ControlOrMeta+-');
    }
  }

  /** Reset browser zoom to 100% (Ctrl/Cmd 0). */
  public async zoomReset(): Promise<void> {
    await this.page.keyboard.press('ControlOrMeta+0');
    await this.resetZoom();
  }

  // ---------------------------------------------------------------------------
  // Viewport, media, screenshots
  // ---------------------------------------------------------------------------

  public async setViewportSize(size: { width: number; height: number }): Promise<void> {
    await this.page.setViewportSize(size);
  }

  public async emulateMedia(options?: Parameters<Page['emulateMedia']>[0]): Promise<void> {
    await this.page.emulateMedia(options);
  }

  public async screenshot(options?: PageScreenshotOptions): Promise<Buffer> {
    return this.page.screenshot(options);
  }

  public async screenshotLocator(
    target: Target,
    options?: LocatorScreenshotOptions
  ): Promise<Buffer> {
    return this.resolveLocator(target).screenshot(options);
  }

  // ---------------------------------------------------------------------------
  // Storage & network (context-level)
  // ---------------------------------------------------------------------------

  public async addCookies(cookies: Parameters<BrowserContext['addCookies']>[0]): Promise<void> {
    await this.page.context().addCookies(cookies);
  }

  public async clearCookies(): Promise<void> {
    await this.page.context().clearCookies();
  }

  public async storageState(options?: Parameters<BrowserContext['storageState']>[0]) {
    return this.page.context().storageState(options);
  }

  public async setExtraHTTPHeaders(headers: Record<string, string>): Promise<void> {
    await this.page.setExtraHTTPHeaders(headers);
  }

  // ---------------------------------------------------------------------------
  // Assertions (Playwright expect)
  // ---------------------------------------------------------------------------

  public async assertTitle(expectedTitle: string | RegExp): Promise<void> {
    await expect(this.page).toHaveTitle(expectedTitle);
  }

  public async assertUrl(expectedUrl: string | RegExp): Promise<void> {
    await expect(this.page).toHaveURL(expectedUrl);
  }

  public async assertElementVisible(target: Target, timeout = BASE_PAGE_DEFAULT_TIMEOUT): Promise<void> {
    await expect(this.resolveLocator(target).first()).toBeVisible({ timeout });
  }

  public async assertElementHidden(target: Target, timeout?: number): Promise<void> {
    await expect(this.resolveLocator(target).first()).toBeHidden({ timeout });
  }

  public async assertTextPresent(
    target: Target,
    text: string | RegExp,
    timeout = BASE_PAGE_DEFAULT_TIMEOUT
  ): Promise<void> {
    await expect(this.resolveLocator(target)).toContainText(text, { timeout });
  }

  public async assertExactText(
    target: Target,
    text: string | RegExp,
    options?: { timeout?: number }
  ): Promise<void> {
    await expect(this.resolveLocator(target)).toHaveText(text, options);
  }

  public async assertValue(
    target: Target,
    value: string | RegExp,
    options?: { timeout?: number }
  ): Promise<void> {
    await expect(this.resolveLocator(target)).toHaveValue(value, options);
  }

  public async assertAttribute(
    target: Target,
    name: string,
    value: string | RegExp,
    options?: { timeout?: number }
  ): Promise<void> {
    await expect(this.resolveLocator(target)).toHaveAttribute(name, value, options);
  }

  public async assertCount(target: Target, count: number, options?: { timeout?: number }): Promise<void> {
    await expect(this.resolveLocator(target)).toHaveCount(count, options);
  }

  /** Use instead of non-existent assertCountAtLeast */
  public async assertCountAtLeast(locator: Locator, minimum: number): Promise<void> {
    const n = await locator.count();
    expect(n).toBeGreaterThanOrEqual(minimum);
  }

  public async assertVisibleByRole(role: Role, options?: RoleOptions): Promise<void> {
    await expect(this.getByRole(role, options)).toBeVisible();
  }

  public async assertTextByRole(
    role: Role,
    options: RoleOptions & { name?: string | RegExp }
  ): Promise<void> {
    await expect(this.getByRole(role, options)).toBeVisible();
  }

  public async assertHeadingVisible(text: string | RegExp): Promise<void> {
    await expect(this.page.getByRole('heading', { name: text })).toBeVisible();
  }

  public async assertEnabled(target: Target, options?: { timeout?: number }): Promise<void> {
    await expect(this.resolveLocator(target)).toBeEnabled(options);
  }

  public async assertDisabled(target: Target, options?: { timeout?: number }): Promise<void> {
    await expect(this.resolveLocator(target)).toBeDisabled(options);
  }

  public async assertChecked(target: Target, options?: { checked?: boolean; timeout?: number }): Promise<void> {
    await expect(this.resolveLocator(target)).toBeChecked(options);
  }
}
