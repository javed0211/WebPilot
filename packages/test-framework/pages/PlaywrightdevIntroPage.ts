import { BasePage } from '../core/BasePage';
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

  public async assertVerifyGettingStartedPageIsDisplayed(): Promise<void> {
    // assertion(medium): URL contains "intro"
    await expect(this.page).toHaveURL(/intro/);
  }
}
