import { test, expect } from '@playwright/test';
import { WwwwikipediaorgHomePage } from '../pages/WwwwikipediaorgHomePage';
import { EnwikipediaorgSoftwareTestingPage } from '../pages/EnwikipediaorgSoftwareTestingPage';
import { EnwikipediaorgTalkSoftwareTestingPage } from '../pages/EnwikipediaorgTalkSoftwareTestingPage';

test('wikipedia_complex_dom_verification', async ({ page }) => {
  const wwwwikipediaorgHomePage = new WwwwikipediaorgHomePage(page);
  await wwwwikipediaorgHomePage.goto();
  await wwwwikipediaorgHomePage.assertVerifyWikipediaHomepageLoadsSuccessfully();
  // assertion(strong): Text "Search Wikipedia" is visible
  await expect(page.getByText('Search Wikipedia').filter({ visible: true }).first()).toBeVisible();
  await wwwwikipediaorgHomePage.fillEnterSoftwareTestingIntoTheSearchInput();
  await wwwwikipediaorgHomePage.clickSearch();
  const enwikipediaorgSoftwareTestingPage = new EnwikipediaorgSoftwareTestingPage(page);
  await enwikipediaorgSoftwareTestingPage.assertVerifyPageUrlContainsSoftwareTesting();
  // assertion(strong): Text "Software testing" is visible
  await expect(page.getByText('Software testing').filter({ visible: true }).first()).toBeVisible();
  // assertion(strong): Text "From Wikipedia, the free encyclopedia" is visible
  await expect(page.getByText('From Wikipedia, the free encyclopedia').filter({ visible: true }).first()).toBeVisible();
  // assertion(strong): Text "Article" is visible
  await expect(page.getByText('Article').filter({ visible: true }).first()).toBeVisible();
  await enwikipediaorgSoftwareTestingPage.clickViewHistory();
  // assertion(strong): Text "Revision history" is visible
  await expect(page.getByText('Revision history').filter({ visible: true }).first()).toBeVisible();
  await page.goBack();
  // assertion(strong): Text "Software testing" is visible
  await expect(page.getByText('Software testing').filter({ visible: true }).first()).toBeVisible();
  // assertion(strong): Text "See also" is visible
  await expect(page.getByText('See also').filter({ visible: true }).first()).toBeVisible();
  // assertion(strong): Text "References" is visible
  await expect(page.getByText('References').filter({ visible: true }).first()).toBeVisible();
  // assertion(strong): Text "External links" is visible
  await expect(page.getByText('External links').filter({ visible: true }).first()).toBeVisible();
  // assertion(strong): Text "Wikipedia" is visible
  await expect(page.getByText('Wikipedia').filter({ visible: true }).first()).toBeVisible();
  // selector: confidence 0.68; signals: visible-text, observed
  await page.getByText('Software testing').first().scrollIntoViewIfNeeded();
  await page.getByText('Software testing').first().screenshot({ path: 'test-results/codegen-section.png' });
  await enwikipediaorgSoftwareTestingPage.clickTalk();
  const enwikipediaorgTalkSoftwareTestingPage = new EnwikipediaorgTalkSoftwareTestingPage(page);
  await enwikipediaorgTalkSoftwareTestingPage.assertVerifyPageUrlContainsTalk();
  await page.goBack();
  // assertion(strong): Text "Software testing" is visible
  await expect(page.getByText('Software testing').filter({ visible: true }).first()).toBeVisible();
  // assertion(strong): Text "Categories" is visible
  await expect(page.getByText('Categories').filter({ visible: true }).first()).toBeVisible();
  // assertion(strong): Text "This page was last edited" is visible
  await expect(page.getByText('This page was last edited').filter({ visible: true }).first()).toBeVisible();
});
