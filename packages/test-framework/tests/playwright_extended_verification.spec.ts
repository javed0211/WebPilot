import { test, expect } from '@playwright/test';
import { PlaywrightHomePage } from '../pages/playwright/PlaywrightHomePage';
import { PlaywrightGettingStartedPage } from '../pages/playwright/PlaywrightGettingStartedPage';
import * as path from 'path';

test.describe('Playwright Extended Homepage and Docs Verification', () => {
  test('should verify homepage, docs, sections, and footer', async ({ page }) => {
    const homePage = new PlaywrightHomePage(page);
    const gettingStartedPage = new PlaywrightGettingStartedPage(page);

    await homePage.goto();
    await homePage.assertHomePageLoaded();

    await homePage.clickGetStarted();
    await gettingStartedPage.assertGettingStartedPageLoaded();
    await expect(page).toHaveURL(/intro/);
    await expect(page.getByRole('heading', { name: /Installation/i }).first()).toBeVisible();

    await page.goBack();
    await homePage.assertHomePageLoaded();

    const homeSections = [
      'Playwright Test',
      'Playwright CLI',
      'Playwright MCP',
      'Built for testing',
      'Built for AI agents',
      'Powerful tooling',
      'Chosen by companies and open source projects',
      'Learn',
      'Community',
      'More',
    ];
    for (const section of homeSections) {
      await homePage.assertSectionVisible(section);
    }

    const screenshotPath = path.join(
      process.cwd(),
      'test-results',
      'chosen_by_companies_section.png'
    );
    await homePage.screenshotSection(
      'Chosen by companies and open source projects',
      screenshotPath
    );

    await homePage.clickDocs();
    await expect(page).toHaveURL(/docs/);
    await gettingStartedPage.assertGettingStartedPageLoaded();

    await page.goBack();
    await homePage.assertHomePageLoaded();
    await homePage.assertFooterCopyright('Copyright © 2026 Microsoft');
  });
});
