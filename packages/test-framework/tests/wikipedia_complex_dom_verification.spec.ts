import { test } from '@playwright/test';
import { WikipediaHomePage } from '../pages/wikipedia/WikipediaHomePage';
import { WikipediaSoftwareTestingPage } from '../pages/wikipedia/WikipediaSoftwareTestingPage';


test('wikipedia_complex_dom_verification', async ({ page }) => {
  // Instantiate page objects
  const homePage = new WikipediaHomePage(page);
  const softwareTestingPage = new WikipediaSoftwareTestingPage(page);

  // Step 1: Navigate to Wikipedia homepage
  await homePage.goto();

  // Step 2: Fill search input with "Software testing"
  await homePage.fillSearchWikipedia();

  // Step 3: Click Search button
  await homePage.clickSearchButton();

  // Step 4: Click "View history" link on Software Testing page
  await softwareTestingPage.clickViewHistoryLink();

  // Step 5: Go back to Software Testing article
  await page.goBack();

  // Step 6: Capture full page screenshot
  await softwareTestingPage.capturePageScreenshot();

  // Step 7: Click "Talk" link in nav
  await softwareTestingPage.clickTalkLink();

  // Step 8: Assert Wikipedia homepage loads successfully (Talk page allowed)
  await homePage.assertWikipediaHomepageLoadsSuccessfully();

  // Step 9: Assert "Search Wikipedia" is visible
  await homePage.assertSearchWikipedia();

  // Step 10: Assert page URL contains "Software_testing"
  await homePage.assertPageUrlContainsSoftwareTesting();

  // Step 11: Assert "Software testing" is displayed
  await softwareTestingPage.assertSoftwareTesting();

  // Step 12: Assert "From Wikipedia, the free encyclopedia" is displayed
  await softwareTestingPage.assertFromWikipediaTheFreeEncyclopedia();

  // Step 13: Assert "Article" is displayed
  await softwareTestingPage.assertArticle();

  // Step 14: Assert "Revision history" is displayed
  await softwareTestingPage.assertRevisionHistory();

  // Step 15: Assert "See also section" is displayed
  await softwareTestingPage.assertSeeAlsoSection();

  // Step 16: Assert "References section" is displayed
  await softwareTestingPage.assertReferencesSection();

  // Step 17: Assert "External links section" is displayed
  await softwareTestingPage.assertExternalLinksSection();

  // Step 18: Assert "Wikipedia" is displayed
  await softwareTestingPage.assertWikipedia();

  // Step 19: Capture screenshot of the "Software testing" heading
  await softwareTestingPage.captureCaptureScreenshotOfTheSoftwareTestingHeading();

  // Step 20: Assert page URL contains "Talk"
  await homePage.assertPageUrlContainsTalk();

  // Step 21: Assert "Categories" is displayed
  await softwareTestingPage.assertCategories();

  // Step 22: Assert "This page was last edited" is displayed
  await softwareTestingPage.assertThisPageWasLastEdited();
});
