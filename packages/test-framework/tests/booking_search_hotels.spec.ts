import { test, expect } from '@playwright/test';
import { BookingHomePage } from '../pages/booking/BookingHomePage';
import { BookingSearchResultsPage } from '../pages/booking/BookingSearchResultsPage';

test('booking_search_hotels', async ({ page }) => {
  const bookingHomePage = new BookingHomePage(page);
  await bookingHomePage.goto();
  await bookingHomePage.waitForPage();
  await bookingHomePage.clickAccept();
  await bookingHomePage.capturePageScreenshot();
  await bookingHomePage.clickDismissSignIn();
  await bookingHomePage.fillDestination();
  await bookingHomePage.waitForPage1();
  await bookingHomePage.clickLondonOption();
  await bookingHomePage.selectCheckInDate();
  await bookingHomePage.selectCheckOutDate();
  await bookingHomePage.clickSearch();
  await bookingHomePage.assertBooking();
  const bookingSearchResultsPage = new BookingSearchResultsPage(page);
  await bookingSearchResultsPage.assertSearchResults();
  await bookingSearchResultsPage.assertLondonResults();
});
