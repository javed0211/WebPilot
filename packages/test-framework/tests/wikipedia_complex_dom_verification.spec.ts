import { test, expect } from '@playwright/test';
import { WikipediaHomePage } from '../pages/wikipedia/WikipediaHomePage';
import { WikipediaSoftwareTestingPage } from '../pages/wikipedia/WikipediaSoftwareTestingPage';

test('wikipedia_complex_dom_verification', async ({ page }) => {
  const wikipediaHomePage = new WikipediaHomePage(page);
  await wikipediaHomePage.goto();
  await wikipediaHomePage.fillSearchWikipedia();
  await wikipediaHomePage.clickSearchButton();
  const wikipediaSoftwareTestingPage = new WikipediaSoftwareTestingPage(page);
  await wikipediaSoftwareTestingPage.clickViewHistoryLink();
  await page.goBack();
  await page.screenshot({ path: 'test-results/codegen-page.png', fullPage: true });
  await wikipediaSoftwareTestingPage.clickTalkLink();
  await wikipediaHomePage.assertWikipediaHomepageLoadsSuccessfully();
  await wikipediaHomePage.assertSearchWikipedia();
  await wikipediaHomePage.assertPageUrlContainsSoftwareTesting();
  await wikipediaSoftwareTestingPage.assertSoftwareTesting();
  await wikipediaSoftwareTestingPage.assertFromWikipediaTheFreeEncyclopedia();
  await wikipediaSoftwareTestingPage.assertArticle();
  await wikipediaSoftwareTestingPage.assertRevisionHistory();
  await wikipediaSoftwareTestingPage.assertSeeAlsoSection();
  await wikipediaSoftwareTestingPage.assertReferencesSection();
  await wikipediaSoftwareTestingPage.assertExternalLinksSection();
  // selector: confidence 0.68; signals: visible-text, observed
  await page.getByText('Capture screenshot of the "Software testing" heading').first().scrollIntoViewIfNeeded();
  await page.getByText('Capture screenshot of the "Software testing" heading').first().screenshot({ path: 'test-results/codegen-section.png' });
  await wikipediaHomePage.assertPageUrlContainsTalk();
  await wikipediaSoftwareTestingPage.assertCategories();
  await wikipediaSoftwareTestingPage.assertThisPageWasLastEdited();
});
