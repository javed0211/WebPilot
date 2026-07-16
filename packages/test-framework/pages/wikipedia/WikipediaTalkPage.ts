import { expect, Locator } from '@playwright/test';
import { BasePage } from '../../core/BasePage';

/**
 * @pageIdentity WikipediaTalkPage
 * @urlPattern /wiki/Talk:
 * @curated
 */
export class WikipediaTalkPage extends BasePage {
  static readonly urlPattern = /\/wiki\/Talk:/;

  mainContent(): Locator {
    return this.page.locator('#content, #mw-content-text').first();
  }

  heading(): Locator {
    return this.page.locator('h1#firstHeading, h1.mw-first-heading').first();
  }

  async assertOnTalkPage() {
    await this.assertUrl(WikipediaTalkPage.urlPattern);
    await expect(this.heading()).toContainText(/Talk:\s*Software testing/i);
    await expect(this.mainContent()).toBeVisible();
  }

  async assertTalkPageLoaded() {
    await this.assertOnTalkPage();
  }

  async assertTextVisible(text: string | RegExp) {
    await expect(this.mainContent().getByText(text, { exact: false }).first()).toBeVisible();
  }
}
