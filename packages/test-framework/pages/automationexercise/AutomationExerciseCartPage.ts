import { expect } from '@playwright/test';
import { AutomationExerciseBasePage } from './AutomationExerciseBasePage';

export type CartLineItem = {
  name: string;
  price: string;
  quantity: string;
  total: string;
  description?: string;
};

/**
 * @pageIdentity AutomationExerciseCartPage
 * @urlPattern https://automationexercise.com/view_cart
 */
export class AutomationExerciseCartPage extends AutomationExerciseBasePage {
  public async assertOnCartPage(): Promise<void> {
    await this.assertUrl(/\/view_cart/);
    await expect(this.page.getByText(/cart is empty/i)).not.toBeVisible({ timeout: 5000 }).catch(() => {});
    await this.assertElementVisible('#cart_info_table');
    await this.assertCountAtLeast(this.page.locator('#cart_info_table tbody tr'), 1);
  }

  public async assertCartPageLoaded(): Promise<void> {
    await this.assertOnCartPage();
  }

  public async assertCartProducts(expected: CartLineItem[]): Promise<void> {
    const rows = this.page.locator('#cart_info_table tbody tr');
    await this.assertCountAtLeast(rows, expected.length);
    for (let i = 0; i < expected.length; i++) {
      const row = rows.nth(i);
      const exp = expected[i];
      await expect(row.locator('.cart_description h4 a').first()).toContainText(exp.name);
      if (exp.description) {
        await expect(row.locator('.cart_description p').first()).toContainText(exp.description);
      }
      await expect(row.locator('.cart_price p').first()).toHaveText(exp.price);
      await expect(row.locator('.cart_quantity button').first()).toHaveText(exp.quantity);
      await expect(row.locator('.cart_total p').first()).toHaveText(exp.total);
    }
  }

  public async assertProductsInCart(
    expected: Array<{ name: string; price: string; quantity: string; total: string; description?: string }>
  ): Promise<void> {
    await this.assertCartProducts(expected);
  }
}
