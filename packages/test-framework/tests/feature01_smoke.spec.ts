import { test, expect } from '@playwright/test';
import { AutomationExerciseHomePage } from '../pages/automationexercise/AutomationExerciseHomePage';

test('AutomationExercise smoke', async ({ page }) => {
  const automationExerciseHomePage = new AutomationExerciseHomePage(page);
  await automationExerciseHomePage.goto();
  // selector: confidence 0.99; signals: semantic, accessible-name, observed, historical-success
  await page.getByRole('link', { name: 'Products' }).click();
  await page.goto('https://automationexercise.com/products');
  // assertion(medium): URL contains "products"
  await expect(page).toHaveURL(/products/);
  // assertion(strong): role selector is visible
  await expect(page.getByRole('heading', { name: 'All Products' })).toBeVisible();
});
