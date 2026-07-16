import { expect, Locator } from '@playwright/test';
import { BasePage } from '../../core/BasePage';

/**
 * @pageIdentity WikipediaHomePage
 * @urlPattern https://www.wikipedia.org/
 * @curated
 */
export class WikipediaHomePage extends BasePage {
  static readonly urlPattern = /^https:\/\/www\.wikipedia\.org\/?$/;

  async goto() {
    await this.navigate('https://www.wikipedia.org/');
  }

  searchInput(): Locator {
    return this.page.locator('input[name="search"]').first();
  }

  searchButton(): Locator {
    return this.page.getByRole('button', { name: 'Search' }).first();
  }

  async assertHomePageLoaded() {
    await this.assertUrl(WikipediaHomePage.urlPattern);
    await expect(this.searchInput()).toBeVisible();
  }

  async fillSearch(term: string) {
    await this.searchInput().fill(term);
  }

  async submitSearch() {
    await this.searchButton().click();
  }

  async search(term: string) {
    await this.fillSearch(term);
    await this.submitSearch();
  }
}
