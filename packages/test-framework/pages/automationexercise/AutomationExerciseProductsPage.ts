import { expect } from '@playwright/test';
import { AutomationExerciseBasePage } from './AutomationExerciseBasePage';

/**
 * @pageIdentity AutomationExerciseProductsPage
 * @urlPattern https://automationexercise.com/products
 */
export class AutomationExerciseProductsPage extends AutomationExerciseBasePage {
  private productCards() {
    return this.page.locator('.features_items .product-image-wrapper');
  }

  public async assertAllProductsVisible(): Promise<void> {
    await this.dismissCookieConsentIfPresent();
    await this.assertHeadingVisible(/All Products/i);
    await this.assertCountAtLeast(this.productCards(), 3);
  }

  public async assertAllProductsPageLoaded(): Promise<void> {
    await this.assertAllProductsVisible();
  }

  public async hoverProductAt(index: number): Promise<void> {
    await this.dismissCookieConsentIfPresent();
    await this.productCards().nth(index).hover();
  }

  public async hoverProductCard(index: number): Promise<void> {
    await this.hoverProductAt(index);
  }

  public async hoverProductByIndex(index: number): Promise<void> {
    await this.hoverProductAt(index);
  }

  public async addToCartProductAt(index: number): Promise<void> {
    await this.dismissCookieConsentIfPresent();
    const addToCart = this.productCards().nth(index).locator('a.add-to-cart').first();
    await addToCart.waitFor({ state: 'visible', timeout: 10000 });
    await Promise.all([
      this.page.waitForResponse(
        (res) => res.url().includes('/add_to_cart/') && res.ok(),
        { timeout: 15000 }
      ),
      addToCart.click({ force: true }),
    ]);
    await expect(this.page.locator('#cartModal')).toContainText(/added/i, { timeout: 10000 });
  }

  public async clickAddToCartByIndex(index: number): Promise<void> {
    await this.addToCartProductAt(index);
  }

  public async handleCartModal(action: 'continue' | 'view'): Promise<void> {
    await this.dismissCookieConsentIfPresent();
    await this.page.locator('#cartModal').waitFor({ state: 'attached', timeout: 10000 });
    if (action === 'continue') {
      await expect(this.page.locator('#cartModal')).toContainText(/added/i);
      await this.page.evaluate(() => {
        (document.querySelector('#cartModal button.close-modal') as HTMLElement | null)?.click();
      });
      await this.page.locator('#cartModal').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      return;
    }
    const viewCart = this.page.locator('#cartModal a[href="/view_cart"]');
    try {
      await viewCart.click({ force: true, timeout: 5000 });
      await this.page.waitForURL(/\/view_cart/, { timeout: 15000 });
    } catch {
      await this.page.evaluate(() => {
        (document.querySelector('#cartModal a[href="/view_cart"]') as HTMLElement | null)?.click();
      });
      try {
        await this.page.waitForURL(/\/view_cart/, { timeout: 10000 });
      } catch {
        await this.navigate('https://automationexercise.com/view_cart');
      }
    }
  }
}
