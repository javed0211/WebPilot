import { BasePage } from '@core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity GithubcomPulsePage
 * @urlPattern https://github.com/microsoft/playwright/pulse
 */
export class GithubcomPulsePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async assertVerifyPageUrlContainsPulse(): Promise<void> {
    // assertion(strong): URL contains "/pulse"
    await expect(this.page).toHaveURL(/\/pulse/);
  }

  public async clickCode(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByRole('link', { name: 'Code' }) (0.76) | getByRole('button', { name: 'Code' }) (0.76) | getByText('Code') (0.68)
    await this.page.locator('a[id="code-tab"]').click();
  }
}
