import { test } from '@playwright/test';
import { WikipediaHomePage } from '../pages/wikipedia/WikipediaHomePage';
import { WikipediaArticlePage } from '../pages/wikipedia/WikipediaArticlePage';
import { WikipediaHistoryPage } from '../pages/wikipedia/WikipediaHistoryPage';
import { WikipediaTalkPage } from '../pages/wikipedia/WikipediaTalkPage';

/**
 * Complex DOM verification across Wikipedia routes using curated POMs.
 * Steps:
 * 1. Navigate to Wikipedia home
 * 2. Search for 'Software testing'
 * 3. Assert article page loaded, verify key sections
 * 4. Click 'View history', assert revision history
 * 5. Go back, screenshot heading
 * 6. Click 'Talk', assert talk page loaded
 */
test('Wikipedia complex DOM verification', async ({ page }) => {
  // 1. Navigate to Wikipedia home
  const home = new WikipediaHomePage(page);
  await home.goto();
  await home.assertHomePageLoaded();

  // 2. Search for 'Software testing'
  await home.search('Software testing');

  // 3. Assert article page loaded, verify key sections
  const article = new WikipediaArticlePage(page);
  await article.assertOnArticlePage();
  await article.assertArticleTabVisible();
  await article.assertTextVisible('Software testing');
  await article.assertTextVisible('From Wikipedia, the free encyclopedia');
  await article.assertSectionVisible('See also');
  await article.assertSectionVisible('References');
  await article.assertSectionVisible('External links');
  await article.assertTextVisible('Wikipedia');
  await article.assertCategoriesVisible();
  await article.assertLastEditedVisible();

  // 4. Click 'View history', assert revision history
  await article.clickViewHistory();
  const history = new WikipediaHistoryPage(page);
  await history.assertOnHistoryPage();
  await history.assertRevisionHistoryVisible();

  // 5. Go back, screenshot heading
  await page.goBack();
  await article.assertOnArticlePage();
  await article.screenshotHeading('software_testing_heading.png');

  // 6. Click 'Talk', assert talk page loaded
  await article.clickTalk();
  const talk = new WikipediaTalkPage(page);
  await talk.assertTalkPageLoaded();
});
