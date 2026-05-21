import { test } from '@playwright/test';
import { AutomationExerciseHomePage } from '@pages/automationexercise/AutomationExerciseHomePage';
import { AutomationExerciseProductsPage } from '@pages/automationexercise/AutomationExerciseProductsPage';
import { AutomationExerciseCartPage } from '@pages/automationexercise/AutomationExerciseCartPage';

// Test: Add Products in Cart on Automation Exercise

test('Add two products to cart and verify cart details', async ({ page }) => {
  // 1. Home page: navigate and verify featured items
  const homePage = new AutomationExerciseHomePage(page);
  await homePage.goto();
  await homePage.assertFeaturedItemsVisible();

  // 2. Go to Products page and verify
  await homePage.goToProductsPage();
  const productsPage = new AutomationExerciseProductsPage(page);
  await productsPage.assertAllProductsVisible();

  // 3. Hover and add first product (Blue Top) to cart, continue shopping
  await productsPage.hoverProductAt(0); // 0-based index: first product
  await productsPage.addToCartProductAt(0);
  await productsPage.handleCartModal('continue');

  // 4. Hover and add second product (Men Tshirt) to cart, then view cart
  await productsPage.hoverProductAt(1); // second product
  await productsPage.addToCartProductAt(1);
  await productsPage.handleCartModal('view');

  // 5. Cart page: verify both products and their details
  const cartPage = new AutomationExerciseCartPage(page);
  await cartPage.assertOnCartPage();
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
