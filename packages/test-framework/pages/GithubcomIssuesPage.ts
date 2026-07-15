import { BasePage } from '@core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity GithubcomIssuesPage
 * @urlPattern https://github.com/microsoft/playwright/issues
 */
export class GithubcomIssuesPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async assertVerifyPageUrlContainsIssues(): Promise<void> {
    // assertion(strong): URL contains "/issues"
    await expect(this.page).toHaveURL(/\/issues/);
  }

  public async clickPullRequests(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByRole('link', { name: 'Pull requests 24' }) (0.82) | getByRole('link', { name: 'Pull requests' }) (0.86) | getByRole('button', { name: 'Pull requests' }) (0.86)
    await this.page.locator('a[id="pull-requests-tab"]').click();
  }
}
