import { test } from '@playwright/test';
import { AutomationExerciseHomePage } from '@pages/automationexercise/AutomationExerciseHomePage';
import { AutomationExerciseProductsPage } from '@pages/automationexercise/AutomationExerciseProductsPage';
import { AutomationExerciseCartPage } from '@pages/automationexercise/AutomationExerciseCartPage';

test.describe('Automation Exercise - Add Products to Cart', () => {
  test('Add two products to cart and verify cart details', async ({ page }) => {
    // Home page
    const home = new AutomationExerciseHomePage(page);
    await home.goto();
    await home.dismissCookieConsentIfPresent();
    await home.assertFeaturedItemsVisible();

    // Go to Products page
    await home.goToProductsPage();
    const products = new AutomationExerciseProductsPage(page);
    await products.assertAllProductsVisible();

    // Add first product (Blue Top) to cart
    await products.hoverProductAt(0);
    await products.addToCartProductAt(0);
    await products.handleCartModal('continue');

    // Add second product (Men Tshirt) to cart
    await products.hoverProductAt(1);
    await products.addToCartProductAt(1);
    await products.handleCartModal('view');

    // Cart page assertions
    const cart = new AutomationExerciseCartPage(page);
    await cart.assertOnCartPage();
    await cart.assertCartProducts([
      {
        name: 'Blue Top',
        price: 'Rs. 500',
        quantity: '1',
        total: 'Rs. 500',
      },
      {
        name: 'Men Tshirt',
        price: 'Rs. 400',
        quantity: '1',
        total: 'Rs. 400',
      },
    ]);
  });
});
