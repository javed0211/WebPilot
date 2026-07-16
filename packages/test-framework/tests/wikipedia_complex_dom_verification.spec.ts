import { test } from '@playwright/test';
import { WikipediaHomePage } from '../pages/wikipedia/WikipediaHomePage';
import { WikipediaArticlePage } from '../pages/wikipedia/WikipediaArticlePage';
import { WikipediaHistoryPage } from '../pages/wikipedia/WikipediaHistoryPage';
import { WikipediaTalkPage } from '../pages/wikipedia/WikipediaTalkPage';

test('wikipedia_complex_dom_verification', async ({ page }) => {
  const home = new WikipediaHomePage(page);
  await home.goto();
  await home.assertHomePageLoaded();
  await home.search('Software testing');

  const article = new WikipediaArticlePage(page);
  await article.assertOnArticlePage();
  await article.clickViewHistory();

  const history = new WikipediaHistoryPage(page);
  await history.assertOnHistoryPage();
  await page.goBack();

  await article.assertOnArticlePage();
  await article.screenshotHeading('software_testing_heading.png');
  await article.clickTalk();

  const talk = new WikipediaTalkPage(page);
  await talk.assertOnTalkPage();
  await page.goBack();

  await article.assertOnArticlePage();
});
