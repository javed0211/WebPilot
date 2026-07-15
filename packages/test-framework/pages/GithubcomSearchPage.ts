import { BasePage } from '@core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity GithubcomSearchPage
 * @urlPattern https://github.com/search?q=microsoft%2Fplaywright&type=repositories
 */
export class GithubcomSearchPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async fillEnterMicrosoftPlaywrightIntoTheSearchInput(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: locator('input[name="query-builder-test"]') (0.62)
    await this.page.locator('input[id="query-builder-test"]').fill('microsoft/playwright');
    // assertion(strong): Form value equals entered value
    await expect(this.page.locator('input[id="query-builder-test"]')).toHaveValue('microsoft/playwright');
  }

  public async pressEnter(): Promise<void> {
    await this.page.keyboard.press('Enter');
  }

  public async assertVerifyPageUrlContainsSearch(): Promise<void> {
    // assertion(strong): URL contains "search"
    await expect(this.page).toHaveURL(/search/);
  }

  public async clickMicrosoftPlaywright(): Promise<void> {
    // selector: confidence 0.99; signals: semantic, accessible-name, observed
    // fallbacks: getByRole('link', { name: 'microsoft/playwright', exact: true }) (0.94) | getByRole('button', { name: 'microsoft/playwright', exact: true }) (0.94) | getByText('microsoft/playwright') (0.68)
    // The actual link does not have spaces around the slash, so we use the correct accessible name.
    await this.page.getByRole('link', { name: 'microsoft/playwright', exact: true }).first().click();
  }
}
