import { test, expect } from '@playwright/test';
import { AutomationExerciseHomePage } from '@pages/automationexercise/AutomationExerciseHomePage';
import { AutomationExerciseProductsPage } from '@pages/automationexercise/AutomationExerciseProductsPage';
import { AutomationExerciseProductDetailPage } from '@pages/automationexercise/AutomationExerciseProductDetailPage';


test.describe('Automation Exercise - Search Product Flow', () => {
  test('User can search for a product and view its details', async ({ page }) => {
    // Home Page
    const home = new AutomationExerciseHomePage(page);
    await home.goto();
    await home.dismissCookieConsentIfPresent();
    await home.assertFeaturedItemsVisible();

    // Navigate to Products
    await home.goToProductsPage();
    const products = new AutomationExerciseProductsPage(page);
    await products.assertAllProductsVisible();

    // Search for 'Blue Top'
    // Strict locator: scope to search input by id
    await page.locator('#search_product').fill('Blue Top');
    await page.locator('#submit_search').click();

    // Verify 'SEARCHED PRODUCTS' text and results
    await expect(page.getByRole('heading', { name: /Searched Products/i })).toBeVisible();
    // At least one product card with 'Blue Top' should be visible
    const blueTopCards = page.locator('.productinfo p', { hasText: 'Blue Top' });
    await products.assertCountAtLeast(blueTopCards, 1);

    // Click 'View Product' on the first searched product
    // Strict: find the first product card with 'Blue Top' and click its 'View Product' link
    // Instead of DOM traversal, scope to the correct product card region
    // Find the first .productinfo p with 'Blue Top', then go up to the .product-image-wrapper
    const firstBlueTopCard = blueTopCards.first();
    const productCard = firstBlueTopCard.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," product-image-wrapper ")][1]');
    await expect(productCard).toBeVisible();
    // Now click the 'View Product' link inside this card
    // Strict: scope to .product-overlay region if present, otherwise .product-image-wrapper
    // Prefer .product-overlay if visible, else fallback
    const overlay = productCard.locator('.product-overlay').filter({ has: page.getByRole('link', { name: /View Product/i }) });
    if (await overlay.isVisible()) {
      await overlay.getByRole('link', { name: /View Product/i }).click();
    } else {
      await productCard.getByRole('link', { name: /View Product/i }).click();
    }

    // Product Detail Page
    const detail = new AutomationExerciseProductDetailPage(page);
    await detail.assertProductNameVisible('Blue Top');
    await detail.assertCategoryVisible(/Women\s*>\s*Tops/i);
    // The price assertion was failing due to strict mode: two spans matched. Instead, scope to .product-information and match the span with exact text 'Rs. 500'
    await expect(
      page.locator('.product-information').locator('span').filter({ hasText: /^Rs\.\s*500$/ })
    ).toBeVisible();
    await detail.assertAvailabilityVisible(/In Stock/i);
    await detail.assertConditionVisible(/New/i);
    await detail.assertBrandVisible(/Polo/i);
  });
});
