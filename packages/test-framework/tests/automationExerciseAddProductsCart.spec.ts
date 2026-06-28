import { test } from '@playwright/test';
import { AutomationExerciseHomePage } from '@pages/automationexercise/AutomationExerciseHomePage';
import { AutomationExerciseProductsPage } from '@pages/automationexercise/AutomationExerciseProductsPage';
import { AutomationExerciseCartPage } from '@pages/automationexercise/AutomationExerciseCartPage';

/**
 * Test: Add Products in Cart on Automation Exercise
 * Steps:
 * - Navigate to home page, verify featured items
 * - Go to Products page, verify ALL PRODUCTS
 * - Hover and add first product ('Blue Top') to cart, handle modal
 * - Hover and add second product ('Men Tshirt') to cart, handle modal
 * - View Cart, verify both products with correct price, quantity, total
 */
test('Add Products in Cart on Automation Exercise', async ({ page }) => {
  // Home page
  const home = new AutomationExerciseHomePage(page);
  await home.goto();
  await home.assertFeaturedItemsVisible();

  // Go to Products page
  await home.goToProductsPage();
  const products = new AutomationExerciseProductsPage(page);
  await products.assertAllProductsVisible();

  // Add first product ('Blue Top') to cart
  await products.hoverProductAt(0); // index 0: Blue Top
  await products.addToCartProductAt(0);
  await products.handleCartModal('continue'); // Click Continue Shopping in modal

  // Add second product ('Men Tshirt') to cart
  await products.hoverProductAt(1); // index 1: Men Tshirt
  await products.addToCartProductAt(1);
  await products.handleCartModal('view'); // Click View Cart in modal

  // Cart page
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
