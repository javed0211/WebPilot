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

  /** Hero / nav "Get started" — prefer href from ActHistory, then role. */
  private getStartedLink(): Locator {
    return this.page
      .locator('a[href="/docs/intro"]')
      .or(this.page.getByRole('link', { name: /get started/i }))
      .first();
  }

  async clickGetStarted() {
    const link = this.getStartedLink();
    await link.waitFor({ state: 'visible', timeout: 15_000 });
    await link.click();
  }

  async assertHomePageLoaded() {
    await expect(this.page).toHaveURL(/playwright\.dev\/?$/);
  }

  async assertSectionVisible(sectionText: string) {
    const target = this.page.getByRole('heading', { name: sectionText, exact: false }).or(
      this.page.getByText(sectionText, { exact: false })
    );
    await target.first().scrollIntoViewIfNeeded();
    await expect(target.filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
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
