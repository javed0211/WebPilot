import { expect } from '@playwright/test';
import { BasePage } from '../../core/BasePage';

/**
 * @pageIdentity PlaywrightGettingStartedPage
 * @urlPattern /docs/intro
 */
export class PlaywrightGettingStartedPage extends BasePage {
  async assertGettingStartedPageLoaded() {
    await expect(this.page).toHaveURL(/\/docs\/intro/);
    await expect(
      this.page.getByRole('heading', { name: /installation|getting started|intro/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  }
}
