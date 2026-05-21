import { test } from '@playwright/test';
import { AutomationExerciseHomePage } from '@pages/automationexercise/AutomationExerciseHomePage';
import { AutomationExerciseProductsPage } from '@pages/automationexercise/AutomationExerciseProductsPage';
import { AutomationExerciseCartPage } from '@pages/automationexercise/AutomationExerciseCartPage';

// Test: Add Products in Cart on Automation Exercise

test('Add Products in Cart on Automation Exercise', async ({ page }) => {
  // 1. Navigate to https://automationexercise.com/
  const homePage = new AutomationExerciseHomePage(page);
  await homePage.goto();
  await homePage.assertFeaturedItemsVisible();

  // 2. Click on Products link in navigation menu
  await homePage.goToProductsPage();

  // 3. Verify user is navigated to ALL PRODUCTS page successfully
  const productsPage = new AutomationExerciseProductsPage(page);
  await productsPage.assertAllProductsVisible();

  // 4. Hover over the first product (Blue Top) and add to cart
  await productsPage.hoverProductAt(0); // 0-based index: first product
  await productsPage.addToCartProductAt(0);
  await productsPage.handleCartModal('continue');

  // 5. Hover over the second product (Men Tshirt) and add to cart
  await productsPage.hoverProductAt(1); // 0-based index: second product
  await productsPage.addToCartProductAt(1);
  await productsPage.handleCartModal('view');

  // 6. Verify user is on the Cart page with both products listed
  const cartPage = new AutomationExerciseCartPage(page);
  await cartPage.assertOnCartPage();

  // 7. Verify each product price, quantity, and total price are visible and correct
  await cartPage.assertCartProducts([
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
