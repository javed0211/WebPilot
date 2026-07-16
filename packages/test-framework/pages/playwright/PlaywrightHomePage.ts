import { expect, Locator } from '@playwright/test';
import { BasePage } from '../../core/BasePage';

/**
 * @pageIdentity PlaywrightHomePage
 * @urlPattern https://playwright\.dev/?$
 */
export class PlaywrightHomePage extends BasePage {
  static readonly url = 'https://playwright.dev/';

  async goto() {
    await this.navigate(PlaywrightHomePage.url, { waitUntil: 'domcontentloaded' });
    await expect(this.page).toHaveURL(/playwright\.dev\/?$/);
  }

  private getStartedLink(): Locator {
    return this.page
      .locator('a[href="/docs/intro"]')
      .or(this.page.getByRole('link', { name: /get started/i }))
      .first();
  }

  private docsLink(): Locator {
    return this.page.getByRole('link', { name: /^Docs$/i }).first();
  }

  async clickGetStarted() {
    const link = this.getStartedLink();
    await link.waitFor({ state: 'visible', timeout: 15_000 });
    await link.click();
  }

  async clickDocs() {
    const link = this.docsLink();
    await link.waitFor({ state: 'visible', timeout: 15_000 });
    await link.click();
  }

  async assertHomePageLoaded() {
    await expect(this.page).toHaveURL(/playwright\.dev\/?$/);
    await expect(this.getStartedLink()).toBeVisible({ timeout: 15_000 });
  }

  async assertSectionVisible(sectionText: string) {
    const heading = this.page.getByRole('heading', { name: sectionText, exact: false });
    const text = this.page.getByText(sectionText, { exact: false });
    const target = (await heading.count()) > 0 ? heading : text;
    await target.first().scrollIntoViewIfNeeded();
    await expect(target.first()).toBeVisible({ timeout: 15_000 });
  }

  async scrollToSection(heading: string) {
    await this.assertSectionVisible(heading);
  }

  async assertFooterCopyright(text: string) {
    await expect(this.page.locator('footer').getByText(text, { exact: false })).toBeVisible({
      timeout: 10_000,
    });
  }

  async screenshotSection(sectionText: string, filePath: string) {
    const section = this.page.getByText(sectionText, { exact: false }).first();
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: filePath });
  }
}
