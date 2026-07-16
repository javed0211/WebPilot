import { expect, Locator, Page } from '@playwright/test';
import { BasePage } from '../../core/BasePage';

export class WikipediaHistoryPage extends BasePage {
  static readonly urlPattern = /\/w\/index.php\?title=Software_testing&action=history/;

  historyMain(): Locator {
    // Main history content region
    return this.page.locator('#content');
  }

  heading(): Locator {
    // Strict: h1#firstHeading
    return this.page.locator('h1#firstHeading');
  }

  async assertOnHistoryPage() {
    await this.assertUrl(WikipediaHistoryPage.urlPattern);
    await expect(this.heading()).toHaveText(/Revision history/);
    await expect(this.historyMain().getByText('Revision history', { exact: false })).toBeVisible();
    await expect(this.historyMain().getByText('View logs for this page', { exact: false })).toBeVisible();
    await expect(this.historyMain().getByRole('heading', { name: /Revision history/ })).toBeVisible();
  }

  async assertRevisionHistoryVisible() {
    // Scope to main history content region to avoid strict mode violation
    await this.assertTextVisible('Revision history');
  }

  async assertTextVisible(text: string | RegExp) {
    // Scope to main history content region to avoid strict mode violation
    await expect(this.historyMain().getByText(text, { exact: false }).first()).toBeVisible();
  }
}
