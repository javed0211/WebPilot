import { BasePage } from '@core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity PlaywrightdevIntroPage
 * @urlPattern https://playwright.dev/docs/intro
 */
export class PlaywrightdevIntroPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async assertVerifyPageUrlContainsIntro(): Promise<void> {
    // assertion(strong): URL contains "intro"
    await expect(this.page).toHaveURL(/intro/);
  }

  public async assertVerifyPageUrlContainsDocs(): Promise<void> {
    // assertion(strong): URL contains "docs"
    await expect(this.page).toHaveURL(/docs/);
  }
}
