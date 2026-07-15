import { BasePage } from '@core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity GithubcomPlaywrightPage
 * @urlPattern https://github.com/microsoft/playwright
 */
export class GithubcomPlaywrightPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async assertVerifyPageUrlContainsMicrosoftPlaywright(): Promise<void> {
    // assertion(strong): URL contains "microsoft/playwright"
    await expect(this.page).toHaveURL(/microsoft\/playwright/);
  }

  public async clickIssues(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByRole('link', { name: 'Issues 149' }) (0.82) | getByRole('link', { name: 'Issues' }) (0.76) | getByRole('button', { name: 'Issues' }) (0.76)
    await this.page.locator('a[id="issues-tab"]').click();
  }

  public async assertVerifyPageUrlContainsMicrosoftPlaywright1(): Promise<void> {
    // assertion(strong): URL contains "microsoft/playwright"
    await expect(this.page).toHaveURL(/microsoft\/playwright/);
  }
}
