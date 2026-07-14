import { test, expect } from '@playwright/test';
import { PlaywrightdevHomePage } from '../pages/PlaywrightdevHomePage';
import { PlaywrightdevIntroPage } from '../pages/PlaywrightdevIntroPage';

test('playwright_page_verification', async ({ page }) => {
  const playwrightdevHomePage = new PlaywrightdevHomePage(page);
  await playwrightdevHomePage.goto();
  await playwrightdevHomePage.assertVerifyPlaywrightHomepageLoadsSuccessfully();
  await playwrightdevHomePage.clickGetStartedButton();
  // assertion(strong): Text "Getting Started" is visible
  await expect(page.getByText('Getting Started').first()).toBeVisible();
  await playwrightdevHomePage.assertVerifyPageUrlContainsIntro();
  await playwrightdevHomePage.navigateBackToThePreviousPage();
  // assertion(strong): Text "Playwright Test" is visible
  await expect(page.getByText('Playwright Test').first()).toBeVisible();
  // assertion(strong): Text "Playwright CLI" is visible
  await expect(page.getByText('Playwright CLI').first()).toBeVisible();
  // assertion(strong): Text "Playwright MCP" is visible
  await expect(page.getByText('Playwright MCP').first()).toBeVisible();
  // assertion(strong): Text "Built for testing" is visible
  await expect(page.getByText('Built for testing').first()).toBeVisible();
  // assertion(strong): Text "Built for AI agents" is visible
  await expect(page.getByText('Built for AI agents').first()).toBeVisible();
  // assertion(strong): Text "Powerful tooling" is visible
  await expect(page.getByText('Powerful tooling').first()).toBeVisible();
  // assertion(strong): Text "Chosen by companies and open source projects" is visible
  await expect(page.getByText('Chosen by companies and open source projects').first()).toBeVisible();
  // selector: confidence 0.68; signals: visible-text, observed
  await page.getByText('Chosen by companies and open source projects').first().scrollIntoViewIfNeeded();
  await page.getByText('Chosen by companies and open source projects').first().screenshot({ path: 'test-results/codegen-section.png' });
  // assertion(strong): Text "Learn" is visible
  await expect(page.getByText('Learn').first()).toBeVisible();
  // assertion(strong): Text "Community" is visible
  await expect(page.getByText('Community').first()).toBeVisible();
  // assertion(strong): Text "More" is visible
  await expect(page.getByText('More').first()).toBeVisible();
  // assertion(strong): Text "Copyright © 2026 Microsoft" is visible
  await expect(page.getByText('Copyright © 2026 Microsoft').first()).toBeVisible();
});
