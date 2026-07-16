import { test } from '@playwright/test';
import * as path from 'path';
import { PlaywrightHomePage } from '../pages/playwright/PlaywrightHomePage';
import { PlaywrightGettingStartedPage } from '../pages/playwright/PlaywrightGettingStartedPage';

test('playwright_page_verification', async ({ page }) => {
  const home = new PlaywrightHomePage(page);
  const gettingStarted = new PlaywrightGettingStartedPage(page);

  await home.goto();
  await home.clickGetStarted();
  await gettingStarted.assertGettingStartedPageLoaded();

  await page.goBack();
  await home.assertHomePageLoaded();

  const homepageSections = [
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
  for (const section of homepageSections) {
    await home.assertSectionVisible(section);
  }

  const screenshotPath = path.join(process.cwd(), 'runtime', 'test-results', 'chosen_by_companies_section.png');
  await home.screenshotSection('Chosen by companies and open source projects', screenshotPath);

  await home.assertFooterCopyright('Copyright © 2026 Microsoft');
});
