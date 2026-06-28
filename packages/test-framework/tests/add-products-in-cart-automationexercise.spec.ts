import { test } from '@playwright/test';
import { AutomationExerciseHomePage } from '@pages/automationexercise/AutomationExerciseHomePage';
import { AutomationExerciseProductsPage } from '@pages/automationexercise/AutomationExerciseProductsPage';
import { AutomationExerciseCartPage } from '@pages/automationexercise/AutomationExerciseCartPage';

/**
 * Test: Add Products in Cart on Automation Exercise
 *
 * Steps:
 * - Navigate to home page
 * - Verify featured items
 * - Go to Products page
 * - Verify ALL PRODUCTS page
 * - Hover and add first product to cart, continue shopping
 * - Hover and add second product to cart, view cart
 * - Verify both products are listed in cart with correct details
 */
test('Add Products in Cart on Automation Exercise', async ({ page }) => {
  // Home page
  const home = new AutomationExerciseHomePage(page);
  await home.goto();
  await home.assertFeaturedItemsVisible();
  await home.goToProductsPage();

  // Products page
  const products = new AutomationExerciseProductsPage(page);
  await products.assertAllProductsVisible();

  // Add first product (Blue Top)
  await products.hoverProductAt(0); // index 0: Blue Top
  await products.addToCartProductAt(0);
  await products.handleCartModal('continue');

  // Add second product (Men Tshirt)
  await products.hoverProductAt(1); // index 1: Men Tshirt
  await products.addToCartProductAt(1);
  await products.handleCartModal('view');

  // Cart page
  const cart = new AutomationExerciseCartPage(page);
  await cart.assertOnCartPage();
  await cart.assertCartProducts([
    {
      name: 'Blue Top',
      description: 'Women > Tops',
      price: 'Rs. 500',
      quantity: '1',
      total: 'Rs. 500',
    },
    {
      name: 'Men Tshirt',
      description: 'Men > Tshirts',
      price: 'Rs. 400',
      quantity: '1',
      total: 'Rs. 400',
    },
  ]);
});
