import { expect, Locator } from '@playwright/test';
import { BasePage } from '../../core/BasePage';

/**
 * @pageIdentity WikipediaHistoryPage
 * @urlPattern action=history
 * @curated
 */
export class WikipediaHistoryPage extends BasePage {
  static readonly urlPattern = /action=history/;

  historyMain(): Locator {
    return this.page.locator('#content, #mw-content-text').first();
  }

  heading(): Locator {
    return this.page.locator('h1#firstHeading, h1.mw-first-heading').first();
  }

  async assertOnHistoryPage() {
    await this.assertUrl(WikipediaHistoryPage.urlPattern);
    await expect(this.heading()).toContainText(/Revision history/i);
  }

  async assertRevisionHistoryVisible() {
    await expect(
      this.historyMain().getByText(/Revision history/i).first()
    ).toBeVisible();
  }

  async assertTextVisible(text: string | RegExp) {
    await expect(this.historyMain().getByText(text, { exact: false }).first()).toBeVisible();
  }
}
