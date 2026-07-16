import { expect, Locator } from '@playwright/test';
import { BasePage } from '../../core/BasePage';

export class WikipediaTalkPage extends BasePage {
  static readonly urlPattern = /\/wiki\/Talk:Software_testing/;

  mainContent(): Locator {
    return this.page.locator('#content');
  }

  heading(): Locator {
    return this.page.locator('h1#firstHeading');
  }

  async assertOnTalkPage() {
    await this.assertUrl(WikipediaTalkPage.urlPattern);
    await expect(this.heading()).toHaveText(/Talk:\s*Software testing/i);
    await expect(this.mainContent()).toBeVisible();
  }


  async assertTalkPageLoaded() {
      await this.assertUrl(WikipediaTalkPage.urlPattern);
      await expect(this.heading()).toBeVisible();
      await this.assertTextVisible('Software testing');
    }

  async assertTextVisible(text: string | RegExp) {
      await expect(this.page.getByText(text, { exact: false })).toBeVisible();
    }
}
