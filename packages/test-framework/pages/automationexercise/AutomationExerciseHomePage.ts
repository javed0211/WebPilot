import { expect } from '@playwright/test';
import { AutomationExerciseBasePage } from './AutomationExerciseBasePage';

/**
 * @pageIdentity AutomationExerciseHomePage
 * @urlPattern https://automationexercise.com/?
 */
export class AutomationExerciseHomePage extends AutomationExerciseBasePage {
  public async goto(): Promise<void> {
    await this.navigate('https://automationexercise.com/');
    await this.dismissCookieConsentIfPresent();
  }

  public async assertFeaturedItemsVisible(): Promise<void> {
    await this.assertHeadingVisible(/FEATURES ITEMS/i);
    const featuredCards = this.page.locator('.features_items .product-image-wrapper');
    await this.assertCountAtLeast(featuredCards, 1);
    await expect(featuredCards.first()).toBeVisible();
  }

  public async goToProductsPage(): Promise<void> {
    await this.openProductsFromNav();
  }

  /** Alias for LLM-generated method names */
  public async clickProductsNav(): Promise<void> {
    await this.goToProductsPage();
  }
}
