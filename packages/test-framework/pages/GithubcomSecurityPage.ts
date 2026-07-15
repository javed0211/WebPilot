import { BasePage } from '@core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity GithubcomSecurityPage
 * @urlPattern https://github.com/microsoft/playwright/security
 */
export class GithubcomSecurityPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async assertVerifyPageUrlContainsSecurity(): Promise<void> {
    // assertion(strong): URL contains "/security"
    await expect(this.page).toHaveURL(/\/security/);
  }

  public async clickInsights(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByRole('link', { name: 'Insights' }) (0.76) | getByRole('button', { name: 'Insights' }) (0.76) | getByText('Insights') (0.68)
    await this.page.locator('a[id="insights-tab"]').click();
  }
}
