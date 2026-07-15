import { BasePage } from '@core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity GithubcomHomePage
 * @urlPattern https://github.com/
 */
export class GithubcomHomePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async goto(): Promise<void> {
    await this.navigate('https://github.com/');
  }

  public async assertVerifyGithubHomepageLoadsSuccessfully(): Promise<void> {
    // assertion(strong): URL is https://github.com/
    await expect(this.page).toHaveURL('https://github.com/');
  }

  public async clickSearchOrJumpTo(): Promise<void> {
    // selector: confidence 0.99; signals: semantic, accessible-name, observed
    // fallbacks: getByRole('button', { name: 'Search or jump to' }) (0.99) | getByRole('link', { name: 'Search or jump to' }) (0.99) | getByPlaceholder('Search or jump to...') (0.82)
    await this.page.getByRole('button', { name: 'Search or jump to…' }).click();
  }
}
