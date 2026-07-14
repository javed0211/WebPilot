import { BasePage } from '@core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity WwwwikipediaorgHomePage
 * @urlPattern https://www.wikipedia.org/
 */
export class WwwwikipediaorgHomePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async goto(): Promise<void> {
    await this.navigate('https://www.wikipedia.org/');
  }

  public async assertVerifyWikipediaHomepageLoadsSuccessfully(): Promise<void> {
    // assertion(strong): URL is https://www.wikipedia.org/
    await expect(this.page).toHaveURL('https://www.wikipedia.org/');
  }

  public async fillEnterSoftwareTestingIntoTheSearchInput(): Promise<void> {
    // selector: confidence 0.62; signals: semantic-css, observed
    // fallbacks: locator('input[id="searchInput"]') (0.42)
    await this.page.locator('input[name="search"]').fill('Software testing');
    // assertion(strong): Form value equals entered value
    await expect(this.page.locator('input[name="search"]')).toHaveValue('Software testing');
  }

  public async clickSearch(): Promise<void> {
    // selector: confidence 0.94; signals: semantic, accessible-name, observed
    // fallbacks: getByRole('link', { name: 'Search' }) (0.94) | getByText('Search') (0.68)
    await this.page.getByRole('button', { name: 'Search' }).click();
  }
}
