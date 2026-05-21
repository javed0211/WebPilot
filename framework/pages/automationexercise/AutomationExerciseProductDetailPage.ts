import { expect } from '@playwright/test';
import { AutomationExerciseBasePage } from './AutomationExerciseBasePage';

/**
 * @pageIdentity AutomationExerciseProductDetailPage
 * @urlPattern https://automationexercise.com/product_details/
 */
export class AutomationExerciseProductDetailPage extends AutomationExerciseBasePage {
  public async assertProductNameVisible(name: string | RegExp): Promise<void> {
    await expect(this.page.locator('.product-information h2')).toHaveText(name);
  }

  public async assertCategoryVisible(category: string | RegExp): Promise<void> {
    await expect(this.page.locator('.product-information p').filter({ hasText: category })).toBeVisible();
  }

  public async assertPriceVisible(price: string | RegExp): Promise<void> {
    // Strict mode: scope to the price span that contains only the price (not the one with Quantity)
    // The price is usually in a <span> that contains only the price text, not the one with Quantity
    await expect(
      this.page.locator('.product-information span').filter({ hasText: price }).filter({ has: this.page.locator(`:scope:has-text("${typeof price === 'string' ? price : ''}")`) }).filter({ hasNot: this.page.locator('span:has-text("Quantity")') })
    ).toBeVisible();
  }

  public async assertAvailabilityVisible(status: string | RegExp): Promise<void> {
    await expect(this.page.locator('.product-information p').filter({ hasText: /Availability:/i })).toContainText(status);
  }

  public async assertConditionVisible(condition: string | RegExp): Promise<void> {
    await expect(this.page.locator('.product-information p').filter({ hasText: /Condition:/i })).toContainText(condition);
  }

  public async assertBrandVisible(brand: string | RegExp): Promise<void> {
    // Strict mode: scope to the product-information region and filter for the Brand line
    await expect(
      this.page.locator('.product-information p').filter({ hasText: /Brand:/i }).filter({ hasText: brand })
    ).toBeVisible();
  }
}
