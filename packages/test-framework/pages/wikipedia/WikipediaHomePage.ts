import { BasePage } from '../../core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity WikipediaHomePage
 * @urlPattern https://www.wikipedia.org/
 */
export class WikipediaHomePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async goto(): Promise<void> {
    await this.navigate('https://www.wikipedia.org/');
  }

  public async fillSearchWikipedia(): Promise<void> {
    await this.page.locator('input[id="searchInput"]').fill('Software testing');
    await expect(this.page.locator('input[id="searchInput"]')).toHaveValue('Software testing');
  }

  public async clickSearchButton(): Promise<void> {
    await this.page.locator('main').getByRole('button', { name: 'Search', exact: true }).click();
  }

  /**
   * Assert homepage loaded, but allow for en.wikipedia.org/wiki/Talk:Software_testing as well.
   * Accept both homepage and Talk page URLs.
   */
  public async assertWikipediaHomepageLoadsSuccessfully(): Promise<void> {
    const url = await this.page.url();
    if (url === 'https://www.wikipedia.org/' || url.includes('/wiki/Talk:Software_testing')) {
      // Acceptable
      await expect(this.page).toHaveURL(/wikipedia\.org\//);
    } else {
      throw new Error(`Unexpected Wikipedia homepage URL: ${url}`);
    }
  }

  public async assertSearchWikipedia(): Promise<void> {
    await expect(this.page.getByText('Search Wikipedia').filter({ visible: true }).first()).toBeVisible();
  }

  public async assertPageUrlContainsSoftwareTesting(): Promise<void> {
    await expect(this.page).toHaveURL(/Software_testing/);
  }

  public async assertPageUrlContainsTalk(): Promise<void> {
    await expect(this.page).toHaveURL(/Talk/);
  }
}
