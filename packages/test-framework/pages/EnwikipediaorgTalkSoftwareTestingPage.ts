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

  public async assertCustomSearchedPageForTalk33MatchesFound(): Promise<void> {
    // assertion(medium): URL contains "Talk:Software_testing"
    await expect(this.page).toHaveURL(/Talk:Software_testing/);
  }

  public async goBackNavigatedBack(): Promise<void> {
    await this.page.goBack();
  }


  public async assertCustom(): Promise<void> {
      await expect(this.page).toHaveURL("https://en.wikipedia.org/wiki/Talk:Software_testing");
    }

  public async assertCustom1(): Promise<void> {
      await expect(this.page).toHaveURL("https://en.wikipedia.org/wiki/Talk:Software_testing");
    }

  public async assertCustom2(): Promise<void> {
      await expect(this.page).toHaveURL("https://en.wikipedia.org/wiki/Talk:Software_testing");
    }
}
