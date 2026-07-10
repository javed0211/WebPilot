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
    const card = this.productCards().nth(index);
    try {
      await card.hover();
    } catch {
      await this.dismissCookieConsentIfPresent();
      await card.hover({ force: true });
    }
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
    const modal = this.page.locator('#cartModal');
    await modal.waitFor({ state: 'visible', timeout: 10000 });
    await expect(modal).toContainText(/added/i);

    if (action === 'continue') {
      const close = modal.locator('button.close-modal');
      if (await close.isVisible().catch(() => false)) {
        await close.click({ force: true });
      } else {
        await this.page.evaluate(() => {
          (document.querySelector('#cartModal button.close-modal') as HTMLElement | null)?.click();
        });
      }
      await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      return;
    }

    const viewCart = modal.locator('a[href="/view_cart"]').first();
    await viewCart.waitFor({ state: 'visible', timeout: 10000 });
    try {
      await Promise.all([
        this.page.waitForURL(/\/view_cart/, { timeout: 30000 }),
        viewCart.click({ force: true }),
      ]);
    } catch {
      await this.page.goto('https://automationexercise.com/view_cart', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    }
    await this.dismissCookieConsentIfPresent();
  }
}
