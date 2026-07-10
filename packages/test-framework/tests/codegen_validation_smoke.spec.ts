import { test, expect } from '@playwright/test';
import { PlaywrightdevHomePage } from '../pages/PlaywrightdevHomePage';

test('codegen_validation_smoke', async ({ page }) => {
  const playwrightdevHomePage = new PlaywrightdevHomePage(page);
  await playwrightdevHomePage.goto();
  // selector: confidence 0.94; signals: semantic, accessible-name, observed
  // fallbacks: getByText('Get started') (0.68) | locator('a[href="/docs/intro"]') (0.42) | locator('a[href*="/docs/intro"]') (0.42)
  await page.getByRole('link', { name: 'Get started' }).click();
  // assertion(medium): URL contains "intro"
  await expect(page).toHaveURL(/intro/);
  await expect(page).toHaveURL("https://playwright.dev/docs/intro");
});
