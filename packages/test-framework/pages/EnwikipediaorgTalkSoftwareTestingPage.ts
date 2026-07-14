import { BasePage } from '@core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity EnwikipediaorgTalkSoftwareTestingPage
 * @urlPattern https://en.wikipedia.org/wiki/Talk:Software_testing
 */
export class EnwikipediaorgTalkSoftwareTestingPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async assertVerifyPageUrlContainsTalk(): Promise<void> {
    // assertion(strong): URL contains "Talk"
    await expect(this.page).toHaveURL(/Talk/);
  }
}
