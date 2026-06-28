import { test } from '@playwright/test';
import { AutomationExerciseHomePage } from '@pages/automationexercise/AutomationExerciseHomePage';
import { AutomationExerciseProductsPage } from '@pages/automationexercise/AutomationExerciseProductsPage';
import { AutomationExerciseProductDetailPage } from '@pages/automationexercise/AutomationExerciseProductDetailPage';


test('Search Product on Automation Exercise', async ({ page }) => {
  // Home page
  const home = new AutomationExerciseHomePage(page);
  await home.goto();
  await home.assertFeaturedItemsVisible();

  // Navigate to Products page
  await home.goToProductsPage();

  // Products listing
  const products = new AutomationExerciseProductsPage(page);
  await products.assertAllProductsVisible();

  // Search for 'Blue Top'
  await page.locator('input#search_product').fill('Blue Top');
  await page.locator('button#submit_search').click();

  // Assert 'SEARCHED PRODUCTS' section and results
  await page.getByRole('heading', { name: /SEARCHED PRODUCTS/i }).first().waitFor({ state: 'visible' });
  await page.getByText('Blue Top', { exact: false }).first().waitFor({ state: 'visible' });

  // Click 'View Product' on first searched result
  await page.locator('a[href="/product_details/1"]').first().click();

  // Product detail page
  const detail = new AutomationExerciseProductDetailPage(page);
  await detail.assertProductNameVisible('Blue Top');
  await detail.assertCategoryVisible('Women > Tops');
  await detail.assertPriceVisible('Rs. 500');
  await detail.assertAvailabilityVisible('In Stock');
  await detail.assertConditionVisible('New');
  await detail.assertBrandVisible('Polo');
});
