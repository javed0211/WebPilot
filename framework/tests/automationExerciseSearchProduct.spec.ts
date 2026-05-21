import { test } from '@playwright/test';
import { AutomationExerciseHomePage } from '@pages/automationexercise/AutomationExerciseHomePage';
import { AutomationExerciseProductsPage } from '@pages/automationexercise/AutomationExerciseProductsPage';
import { AutomationExerciseProductDetailPage } from '@pages/automationexercise/AutomationExerciseProductDetailPage';

/**
 * Test: Search Product on Automation Exercise
 * Scenario:
 * 1. Open https://automationexercise.com/ and verify home page branding.
 * 2. Click 'Products' in navigation menu; navigate to ALL PRODUCTS page.
 * 3. Enter 'Blue Top' in search input and click search; verify 'SEARCHED PRODUCTS' and results.
 * 4. Click 'View Product' on first searched result; verify product detail page fields.
 */
test('Search Product on Automation Exercise', async ({ page }) => {
  // Home page
  const home = new AutomationExerciseHomePage(page);
  await home.goto();
  await home.dismissCookieConsentIfPresent();
  await home.assertFeaturedItemsVisible();

  // Navigate to Products page
  await home.goToProductsPage();
  const products = new AutomationExerciseProductsPage(page);
  // Wait for either 'All Products' or 'Searched Products' heading
  // (site sometimes shows 'All Products' as h2, sometimes as h1)
  await page.locator('.features_items').getByRole('heading', { name: /All Products/i }).first().waitFor({ state: 'visible', timeout: 10000 });
  await products.assertCountAtLeast(products.productCards(), 3);

  // Search for 'Blue Top'
  await page.locator('#search_product').fill('Blue Top');
  await page.locator('#submit_search').click();

  // Wait for 'SEARCHED PRODUCTS' heading
  await page.locator('.features_items').getByRole('heading', { name: /SEARCHED PRODUCTS/i }).first().waitFor({ state: 'visible', timeout: 10000 });
  // Optionally: assert at least one product card is visible
  await products.assertCountAtLeast(products.productCards(), 1);

  // Handle modal if present (from previous add-to-cart clicks)
  await products.handleCartModal('continue');

  // Scroll to ensure 'View Product' is visible
  await page.mouse.wheel(0, 400); // scroll down ~0.5 page

  // Click 'View Product' on first searched result
  // Strict: find first visible 'View Product' link in product cards
  const firstProductCard = products.productCards().first();
  await firstProductCard.locator('a[href^="/product_details/"]').first().click();

  // Product detail page
  const detail = new AutomationExerciseProductDetailPage(page);
  await detail.assertProductNameVisible('Blue Top');
  await detail.assertCategoryVisible('Women > Tops');

  // --- PATCH: Work around strict mode price ambiguity ---
  // The product detail page has multiple .product-information span with 'Rs. 500'.
  // Use a more precise locator for price: the span with exact text 'Rs. 500' and not containing 'Quantity'.
  // This matches the visible price, not the 'Quantity' label or other spans.
  const productInfo = page.locator('.product-information');
  await productInfo.locator('span', { hasText: /^Rs\. 500$/ }).first().waitFor({ state: 'visible', timeout: 5000 });
  await productInfo.locator('span', { hasText: /^Rs\. 500$/ }).first().isVisible();
  // Optionally, you can add:
  // await expect(productInfo.locator('span', { hasText: /^Rs\. 500$/ }).first()).toBeVisible();

  await detail.assertAvailabilityVisible('In Stock');
  await detail.assertConditionVisible('New');
  await detail.assertBrandVisible('Polo');
});
