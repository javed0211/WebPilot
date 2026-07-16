import { BasePage } from '../../core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity BookingHomePage
 * @urlPattern https://www.booking.com/
 */
export class BookingHomePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async goto(): Promise<void> {
    await this.navigate('https://www.booking.com/');
  }

  public async wait3WaitedFor3Seconds(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  public async clickAcceptClickedButtonAcceptIdOnetrustAcceptBtn(): Promise<void> {
    // selector: confidence 0.94; signals: semantic, accessible-name, observed
    // fallbacks: locator('button[id="onetrust-accept-btn-handler"]') (0.90) | getByText('Accept') (0.68) | locator('//button[normalize-space(.)=\'Accept\']') (0.25)
    await this.page.getByRole('button', { name: 'Accept' }).click();
  }

  public async screenshotRequestedScreenshotForNextObservation(): Promise<void> {
    await this.page.screenshot({ path: 'test-results/codegen-page.png', fullPage: true });
  }

  public async clickDismissSignInInformationClickedButtonAriaLabelDismissSignInInfo(): Promise<void> {
    // selector: confidence 0.99; signals: semantic, accessible-name, observed
    // fallbacks: getByText('Dismiss sign in information.') (0.68) | locator('button[aria-label="Dismiss sign in information."]') (0.62) | locator('//button[@aria-label=\'Dismiss sign in information.\']') (0.25)
    // Fix: Only click if the button is visible (do not block test if not present)
    const dismissBtn = this.page.getByRole('button', { name: 'Dismiss sign in information.', exact: true });
    if (await dismissBtn.isVisible({ timeout: 3000 })) {
      await dismissBtn.click();
    }
  }

  public async fillNavigateToHttpsWwwBookingComIndexEnGbHtmlAid304142LabelGen173nr10caeoggi46adim1geafciaqgyato4aqfiaqzyaqpoaqh4aqgiaggoagg4ap2s5digwaib0gikotqxmtuymzmtmwrjzc00ytu0lwi5ymetnmqzyjnlmzq5nthl2aib4aibChalT1784236316566ForceReferer(): Promise<void> {
    // selector: confidence 0.99; signals: semantic, accessible-name, observed
    // fallbacks: locator('input[id="searchbox-horizontal-destination-input"]') (0.90) | getByPlaceholder('Family-friendly apartments in Paris that allow pets') (0.82) | getByText('Enter destination') (0.68)
    const input = this.page.getByRole('combobox', { name: 'Enter destination' });
    await input.fill('London');
    // Wait for autocomplete suggestions to appear
    await this.page.waitForSelector('li[id^="autocomplete-result-"]', { timeout: 10000 });
    // Do not press Enter or assert value here; suggestion will be clicked in next step
  }

  public async wait2WaitedFor2Seconds(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  public async clickNavigateToHttpsWwwBookingComIndexEnGbHtmlAid304142LabelGen173nr10caeoggi46adim1geafciaqgyato4aqfiaqzyaqpoaqh4aqgiaggoagg4ap2s5digwaib0gikotqxmtuymzmtmwrjzc00ytu0lwi5ymetnmqzyjnlmzq5nthl2aib4aibChalT1784236316566ForceReferer(): Promise<void> {
    // selector: confidence 0.99; signals: semantic, accessible-name, observed
    // fallbacks: locator('li[id="autocomplete-result-0"]') (0.90) | getByText('London Greater London, United Kingdom') (0.68) | locator('//li[@id=\'autocomplete-result-0\']') (0.25)
    await this.page.getByRole('option', { name: 'London Greater London, United Kingdom' }).click();
  }

  public async clickNavigateToHttpsWwwBookingComIndexEnGbHtmlAid304142LabelGen173nr10caeoggi46adim1geafciaqgyato4aqfiaqzyaqpoaqh4aqgiaggoagg4ap2s5digwaib0gikotqxmtuymzmtmwrjzc00ytu0lwi5ymetnmqzyjnlmzq5nthl2aib4aibChalT1784236316566ForceReferer1(): Promise<void> {
    // selector: confidence 0.82; signals: semantic, accessible-name, observed; risks: counter-suffixed-name
    // fallbacks: getByText('Thursday, 23 July 2026') (0.68) | locator('span[aria-label="Thursday, 23 July 2026"]') (0.62) | locator('//span[@aria-label=\'Thursday, 23 July 2026\']') (0.25)
    await this.page.getByRole('checkbox', { name: 'Thursday, 23 July 2026' }).click();
  }

  public async clickNavigateToHttpsWwwBookingComIndexEnGbHtmlAid304142LabelGen173nr10caeoggi46adim1geafciaqgyato4aqfiaqzyaqpoaqh4aqgiaggoagg4ap2s5digwaib0gikotqxmtuymzmtmwrjzc00ytu0lwi5ymetnmqzyjnlmzq5nthl2aib4aibChalT1784236316566ForceReferer2(): Promise<void> {
    // selector: confidence 0.82; signals: semantic, accessible-name, observed; risks: counter-suffixed-name
    // fallbacks: getByText('Saturday, 25 July 2026') (0.68) | locator('span[aria-label="Saturday, 25 July 2026"]') (0.62) | locator('//span[@aria-label=\'Saturday, 25 July 2026\']') (0.25)
    await this.page.getByRole('checkbox', { name: 'Saturday, 25 July 2026' }).click();
  }

  public async clickSearchClickedButtonSearch(): Promise<void> {
    // selector: confidence 0.94; signals: semantic, accessible-name, observed
    // fallbacks: getByText('Search') (0.68) | locator('//button[normalize-space(.)=\'Search\']') (0.25) | locator('//button[contains(normalize-space(.), \'Search\')]') (0.25)
    await this.page.getByRole('button', { name: 'Search' }).click();
  }
}
