import { test, expect } from '@playwright/test';
import { BookingHomePage } from '../pages/booking/BookingHomePage';
import { BookingSearchResultsPage } from '../pages/booking/BookingSearchResultsPage';

test('booking_search_hotels', async ({ page }) => {
  const bookingHomePage = new BookingHomePage(page);
  await bookingHomePage.goto();
  await bookingHomePage.waitForPage();
  await bookingHomePage.clickAcceptButton();
  await bookingHomePage.capturePageScreenshot();
  await bookingHomePage.clickDismissSignInInformationButton();
  await bookingHomePage.fillEnterDestinationCombobox();
  await bookingHomePage.clickLondonGreaterLondonUnitedKingdomOption();
  await bookingHomePage.clickSelectDatesCheckInDateCheckOut();
  await bookingHomePage.clickSearchButton();
  const bookingSearchResultsPage = new BookingSearchResultsPage(page);
  // custom: Scrolled down 2.0 pages
  await bookingHomePage.assertBookingComLink();
  await bookingSearchResultsPage.assertSearchResultsPage();
  await bookingSearchResultsPage.assertDestinationIsLondonAndAccommodationResults();
});
