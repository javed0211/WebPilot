import { BasePage } from '@core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity GithubcomActionsPage
 * @urlPattern https://github.com/microsoft/playwright/actions
 */
export class GithubcomActionsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async clickActions(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByRole('link', { name: 'Actions' }) (0.76) | getByRole('button', { name: 'Actions' }) (0.76) | getByText('Actions') (0.68)
    await this.page.locator('a[id="actions-tab"]').click();
  }

  public async assertVerifyPageUrlContainsActions(): Promise<void> {
    // assertion(strong): URL contains "/actions"
    await expect(this.page).toHaveURL(/\/actions/);
  }

  public async clickSecurity(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByRole('link', { name: 'Security and quality 0' }) (0.82) | getByRole('link', { name: 'Security' }) (0.76) | getByRole('button', { name: 'Security' }) (0.76)
    await this.page.locator('a[id="security-and-quality-tab"]').click();
  }
}
