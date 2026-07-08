import * as fs from 'fs';
import * as path from 'path';

export const FRAMEWORK_BASE_PAGE_REL_PATH = 'packages/test-framework/core/BasePage.ts';

/** Minimal BasePage for init when the full template is unavailable (older installs). */
export const MINIMAL_BASE_PAGE_FALLBACK = `import { Page, Locator, expect } from '@playwright/test';

type Role = Parameters<Page['getByRole']>[0];
type RoleOptions = Parameters<Page['getByRole']>[1];

export class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  public async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'load' });
  }

  public async click(selector: string, timeout = 10000): Promise<void> {
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible', timeout });
    await locator.click();
  }

  public async fill(selector: string, value: string, timeout = 10000): Promise<void> {
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible', timeout });
    await locator.fill(value);
  }

  public async getText(selector: string, timeout = 10000): Promise<string> {
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible', timeout });
    return (await locator.innerText()).trim();
  }

  public async isVisible(selector: string, timeout = 5000): Promise<boolean> {
    try {
      await this.page.locator(selector).waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  public async clickByRole(role: Role, options?: RoleOptions): Promise<void> {
    await this.page.getByRole(role, options).click();
  }

  public async assertTitle(expectedTitle: string): Promise<void> {
    await expect(this.page).toHaveTitle(expectedTitle);
  }

  public async assertUrl(expectedUrl: string | RegExp): Promise<void> {
    await expect(this.page).toHaveURL(expectedUrl);
  }

  public async assertTextPresent(selector: string, text: string, timeout = 10000): Promise<void> {
    await expect(this.page.locator(selector)).toContainText(text, { timeout });
  }

  public async assertElementVisible(selector: string, timeout = 10000): Promise<void> {
    await expect(this.page.locator(selector)).toBeVisible({ timeout });
  }

  public async assertHeadingVisible(text: string | RegExp): Promise<void> {
    await expect(this.page.getByRole('heading', { name: text })).toBeVisible();
  }

  public async assertCountAtLeast(locator: Locator, minimum: number): Promise<void> {
    const n = await locator.count();
    expect(n).toBeGreaterThanOrEqual(minimum);
  }
}
`;

function resolveInstallRoot(): string | null {
  const explicit = process.env.WEBPILOT_INSTALL_ROOT;
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }
  let current = path.resolve(__dirname, '..', '..');
  while (true) {
    const packagePath = path.join(current, 'package.json');
    if (fs.existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { name?: string; bin?: unknown };
        const name = pkg.name ?? '';
        if (name === 'webpilot' || /(^|\/)webpilot$/.test(name)) {
          return current;
        }
      } catch {
        // continue walking
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function loadFrameworkBasePageContent(): string | null {
  const candidates = [
    process.env.WEBPILOT_INSTALL_ROOT
      ? path.join(process.env.WEBPILOT_INSTALL_ROOT, FRAMEWORK_BASE_PAGE_REL_PATH)
      : null,
    resolveInstallRoot()
      ? path.join(resolveInstallRoot()!, FRAMEWORK_BASE_PAGE_REL_PATH)
      : null,
    path.join(process.cwd(), FRAMEWORK_BASE_PAGE_REL_PATH),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }
  return null;
}

export function resolveFrameworkBasePageContent(): string {
  return loadFrameworkBasePageContent() ?? MINIMAL_BASE_PAGE_FALLBACK;
}
