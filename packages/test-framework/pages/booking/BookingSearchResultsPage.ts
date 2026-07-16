import { expect, Page } from '@playwright/test';
import { BasePage } from '../../core/BasePage';

/**
 * @pageIdentity BookingSearchResultsPage
 * @urlPattern /\/searchresults(?:\.[a-z-]+)?\.html/i
 */
export class BookingSearchResultsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async assertSearchResults(): Promise<void> {
    await expect(this.page).toHaveURL(/searchresults/i);
  }

  public async assertLondonResults(): Promise<void> {
    await expect(this.page).toHaveURL(/[?&]ss=London/i);
    await expect(
      this.page.locator('[data-testid="property-card"], [data-testid="property-card-container"]').first()
    ).toBeVisible();
  }
}
