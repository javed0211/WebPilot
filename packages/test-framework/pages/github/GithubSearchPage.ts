import { BasePage } from '../../core/BasePage';
import { Page } from '@playwright/test';

/**
 * @pageIdentity GithubSearchPage
 * @urlPattern https://github.com/search?q=microsoft%2Fplaywright&type=repositories
 */
export class GithubSearchPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async clickMicrosoftPlaywrightClickedAMicrosoftPlaywright(): Promise<void> {
    // selector: confidence 0.94; signals: semantic, accessible-name, observed
    // fallbacks: getByText('microsoft/playwright') (0.68) | locator('a[href="/microsoft/playwright"]') (0.64) | locator('//a[@href=\'/microsoft/playwright\']') (0.25)
    await this.page.getByRole('link', { name: 'microsoft/playwright', exact: true }).click();
  }
}
