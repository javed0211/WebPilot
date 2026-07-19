import { test, expect } from '@playwright/test';
import { AmazonHomePage } from '../pages/amazon/AmazonHomePage';
import { AmazonSPage } from '../pages/amazon/AmazonSPage';

test('amazon_search_product', async ({ page }) => {
  const amazonHomePage = new AmazonHomePage(page);
  await amazonHomePage.goto();
  await amazonHomePage.clickContinueShoppingButton();
  await amazonHomePage.fillSearchAmazonSearchbox();
  await amazonHomePage.clickGoButton();
  const amazonSPage = new AmazonSPage(page);
  // custom: Scrolled down 997px
  await amazonSPage.assertAmazonLogoAndMainSearchInput();
  await amazonSPage.assertSearchResultsPage();
  await amazonSPage.assertResultsHeadingOrSummaryContainsWirelessMouse();
  await amazonSPage.assertAtLeastOneProductResult();
  await amazonSPage.assertFirstVisibleProductResultShowsAProduct();
  await amazonSPage.assertFirstVisibleProductResultShowsAPrice();
});
