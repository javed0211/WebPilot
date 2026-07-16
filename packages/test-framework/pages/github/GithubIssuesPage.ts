import { BasePage } from '../../core/BasePage';
import { Page } from '@playwright/test';

/**
 * @pageIdentity GithubIssuesPage
 * @urlPattern https://github.com/microsoft/playwright/issues
 */
export class GithubIssuesPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async clickPullRequests21ClickedAPullRequests21IdPullRequestsTab(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByRole('link', { name: 'Pull requests 21' }) (0.82) | getByText('Pull requests 21') (0.68) | locator('a[href="/microsoft/playwright/pulls"]') (0.64)
    await this.page.locator('a[id="pull-requests-tab"]').click();
  }

  public async clickActionsClickedAActionsIdActionsTab(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByRole('link', { name: 'Actions' }) (0.76) | getByText('Actions') (0.68) | locator('a[href="/microsoft/playwright/actions"]') (0.64)
    await this.page.locator('a[id="actions-tab"]').click();
  }
}
