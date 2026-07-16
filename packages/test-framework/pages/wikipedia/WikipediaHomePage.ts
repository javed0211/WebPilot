import { expect, Locator } from '@playwright/test';
import { BasePage } from '../../core/BasePage';

export class WikipediaHomePage extends BasePage {
  static readonly urlPattern = /^https:\/\/www\.wikipedia\.org\/?$/;

  async goto() {
    await this.navigate('https://www.wikipedia.org/');
  }

  searchInput(): Locator {
    // Fix: Wikipedia search input is not inside a form[role="search"]; use visible input[name="search"] at top-level
    return this.page.locator('input[name="search"]').first();
  }

  searchButton(): Locator {
    // Fix: The search button is not inside a form[role="search"]; use visible button[type=submit][name=Search] at top-level
    return this.page.getByRole('button', { name: 'Search' }).first();
  }

  async assertHomePageLoaded() {
    await this.assertUrl(WikipediaHomePage.urlPattern);
    // Use the strict input[name="search"] at top-level, not inside a form[role="search"]
    await expect(this.searchInput()).toBeVisible();
  }

  async fillSearch(term: string) {
    await this.searchInput().fill(term);
  }

  async submitSearch() {
    await this.searchButton().click();
  }


  async search(term: string) {
      await this.searchInput().fill(term);
      await this.searchButton().click();
    }
}
