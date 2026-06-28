import { test } from '@playwright/test';
import { BookingHomePage } from '@pages/BookingHomePage';

test('Search for hotels on Booking.com', async ({ page }) => {
  const homePage = new BookingHomePage(page);

  await homePage.goto();

  // Use a more specific destination so Booking autocomplete reliably returns options.
  const resultsPage = await homePage.searchHotels(
    'London, Greater London, United Kingdom',
    '2026-06-29',
    '2026-07-01'
  );

  await resultsPage.assertLoaded();
  await resultsPage.assertDestinationIsLondon();
  await resultsPage.assertAccommodationResultsVisible();
});