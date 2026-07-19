import { BasePage } from '../../core/BasePage';
import { Page, expect } from '@playwright/test';

/**
 * @pageIdentity AmazonSPage
 * @urlPattern https://www.amazon.com/s?
 */
export class AmazonSPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async assertAmazonLogoAndMainSearchInput(): Promise<void> {
    // assertion: Amazon logo is visible
    await expect(this.page.locator('a[href="/ref=nav_logo"]')).toBeVisible();
    // assertion: main search input is visible
    await expect(this.page.locator('input#twotabsearchtextbox')).toBeVisible();
  }

  public async assertSearchResultsPage(): Promise<void> {
    // assertion: at least one product result is visible
    await expect(this.page.locator('[data-component-type="s-search-result"]')).toBeVisible();
  }

  public async assertAtLeastOneProductResult(): Promise<void> {
    await this.assertSearchResultsPage();
  }

  public async assertFirstVisibleProductResultShowsAProduct(): Promise<void> {
    // assertion: first product result has a title
    const firstProduct = this.page.locator('[data-component-type="s-search-result"]').first();
    await expect(firstProduct.locator('h2')).toBeVisible();
  }

  public async assertFirstVisibleProductResultShowsAPrice(): Promise<void> {
    // assertion: first product result has a price
    const firstProduct = this.page.locator('[data-component-type="s-search-result"]').first();
    // Price can be in span.a-price > span.a-offscreen
    await expect(firstProduct.locator('.a-price .a-offscreen')).toBeVisible();
  }

  public async assertResultsHeadingOrSummaryContainsWirelessMouse(): Promise<void> {
    // assertion: heading or summary contains 'wireless mouse'
    const heading = this.page.locator('span.a-color-state.a-text-bold');
    await expect(heading).toContainText(/wireless mouse/i);
  }
}
