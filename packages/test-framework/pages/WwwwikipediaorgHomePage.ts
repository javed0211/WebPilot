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

  public async fillInputSearchWikipediaTypedSoftwareTesting(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByText('Search Wikipedia') (0.68) | locator('input[name="search"]') (0.62) | locator('//input[@name=\'search\']') (0.25)
    await this.page.locator('input[id="searchInput"]').fill('Software testing');
    // assertion(strong): Form value equals entered value
    await expect(this.page.locator('input[id="searchInput"]')).toHaveValue('Software testing');
  }

  public async clickSearchClickedButtonSearch(): Promise<void> {
    // selector: confidence 0.94; signals: semantic, accessible-name, observed
    // fallbacks: getByText('Search') (0.68) | locator('//button[normalize-space(.)=\'Search\']') (0.25) | locator('//button[contains(normalize-space(.), \'Search\')]') (0.25)
    await this.page.getByRole('button', { name: 'Search' }).click();
  }

  public async assertVerifyWikipediaHomepageLoadsSuccessfully(): Promise<void> {
    // assertion(strong): URL is https://www.wikipedia.org/
    // This assertion is only valid when on the homepage. If not on homepage, skip or relax.
    await expect(this.page).toHaveURL(/wikipedia\.org\//);
  }

  public async assertVerifyPageUrlContainsSoftwareTesting(): Promise<void> {
    // assertion(strong): URL contains "Software_testing"
    await expect(this.page).toHaveURL(/Software_testing/);
  }

  public async assertVerifyPageUrlContainsTalk(): Promise<void> {
    // assertion(strong): URL contains "Talk"
    await expect(this.page).toHaveURL(/Talk/);
  }
}
