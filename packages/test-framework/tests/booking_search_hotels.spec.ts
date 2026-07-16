import { test, expect } from '@playwright/test';
import { BookingHomePage } from '../pages/booking/BookingHomePage';

test('booking_search_hotels', async ({ page }) => {
  const bookingHomePage = new BookingHomePage(page);
  await bookingHomePage.goto();
  await bookingHomePage.wait3WaitedFor3Seconds();
  await bookingHomePage.clickAcceptClickedButtonAcceptIdOnetrustAcceptBtn();
  await bookingHomePage.screenshotRequestedScreenshotForNextObservation();
  await bookingHomePage.clickDismissSignInInformationClickedButtonAriaLabelDismissSignInInfo();
  await bookingHomePage.fillNavigateToHttpsWwwBookingComIndexEnGbHtmlAid304142LabelGen173nr10caeoggi46adim1geafciaqgyato4aqfiaqzyaqpoaqh4aqgiaggoagg4ap2s5digwaib0gikotqxmtuymzmtmwrjzc00ytu0lwi5ymetnmqzyjnlmzq5nthl2aib4aibChalT1784236316566ForceReferer();
  await bookingHomePage.wait2WaitedFor2Seconds();
  await bookingHomePage.clickNavigateToHttpsWwwBookingComIndexEnGbHtmlAid304142LabelGen173nr10caeoggi46adim1geafciaqgyato4aqfiaqzyaqpoaqh4aqgiaggoagg4ap2s5digwaib0gikotqxmtuymzmtmwrjzc00ytu0lwi5ymetnmqzyjnlmzq5nthl2aib4aibChalT1784236316566ForceReferer();
  await bookingHomePage.clickNavigateToHttpsWwwBookingComIndexEnGbHtmlAid304142LabelGen173nr10caeoggi46adim1geafciaqgyato4aqfiaqzyaqpoaqh4aqgiaggoagg4ap2s5digwaib0gikotqxmtuymzmtmwrjzc00ytu0lwi5ymetnmqzyjnlmzq5nthl2aib4aibChalT1784236316566ForceReferer1();
  await bookingHomePage.clickNavigateToHttpsWwwBookingComIndexEnGbHtmlAid304142LabelGen173nr10caeoggi46adim1geafciaqgyato4aqfiaqzyaqpoaqh4aqgiaggoagg4ap2s5digwaib0gikotqxmtuymzmtmwrjzc00ytu0lwi5ymetnmqzyjnlmzq5nthl2aib4aibChalT1784236316566ForceReferer2();
  await bookingHomePage.clickSearchClickedButtonSearch();
  // assertion(strong): Text "Booking.com logo and accommodation search form" is visible
  await expect(page.getByText('Booking.com logo and accommodation search form').filter({ visible: true }).first()).toBeVisible();
  // assertion(strong): Text "search results page" is visible
  await expect(page.getByText('search results page').filter({ visible: true }).first()).toBeVisible();
  // assertion(strong): Text "destination is London and accommodation results" is visible
  await expect(page.getByText('destination is London and accommodation results').filter({ visible: true }).first()).toBeVisible();
});
