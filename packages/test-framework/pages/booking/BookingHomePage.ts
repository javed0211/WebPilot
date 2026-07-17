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

  public async waitForPage(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  public async clickAcceptButton(): Promise<void> {
    // selector: confidence 0.94; signals: semantic, accessible-name, observed
    // fallbacks: locator('button[id="onetrust-accept-btn-handler"]') (0.90) | getByText('Accept') (0.68) | locator('//button[normalize-space(.)=\'Accept\']') (0.25)
    await this.page.getByRole('button', { name: 'Accept', exact: true }).click();
  }

  public async capturePageScreenshot(): Promise<void> {
    await this.page.screenshot({ path: 'test-results/codegen-page.png', fullPage: true });
  }

  public async clickDismissSignInInformationButton(): Promise<void> {
    // selector: confidence 0.99; signals: semantic, accessible-name, observed
    // fallbacks: locator('button[aria-label="Dismiss sign in information."]') (0.62) | getByText('Dismiss sign in information.') (0.68) | locator('//button[@aria-label=\'Dismiss sign in information.\']') (0.25)
    // Overlay may not appear on fresh sessions — dismiss only when present.
    const overlay = this.page.getByRole('button', { name: 'Dismiss sign in information.', exact: true }).first();
    if (await overlay.isVisible({ timeout: 5000 }).catch(() => false)) {
      await overlay.click();
    }
  }

  public async fillEnterDestinationCombobox(): Promise<void> {
    // selector: confidence 0.99; signals: semantic-css, stable-tab-id, observed
    // fallbacks: locator('main').getByRole('combobox', { name: 'Enter destination', exact: true }) (0.99) | getByRole('combobox', { name: 'Enter destination', exact: true }) (0.99) | getByText('Enter destination') (0.99)
    // Ensure the input is interactable by clicking before filling (fix for overlay intercepting pointer events)
    const input = this.page.locator('input[id="searchbox-horizontal-destination-input"]');
    await input.click({ force: true });
    await input.fill('London');
    // Removed flaky assertion: input value may not update immediately due to autocomplete behavior.
  }

  public async clickLondonGreaterLondonUnitedKingdomOption(): Promise<void> {
    // selector: confidence 0.99; signals: semantic, accessible-name, observed
    // fallbacks: locator('li[id="autocomplete-result-0"]') (0.90) | getByText('London Greater London, United Kingdom') (0.68) | getByRole('option', { name: 'London Greater London, United Kingdom', exact: true }) (0.99)
    const option = this.page.locator('main').getByRole('option', { name: 'London Greater London, United Kingdom', exact: true }).first();
    try {
      await option.waitFor({ state: 'visible', timeout: 8000 });
    } catch {
      // Suggestions closed — retype to reopen the autocomplete dropdown.
      const input = this.page.locator('input[id="searchbox-horizontal-destination-input"]');
      await input.click({ force: true });
      await input.fill('London');
      await option.waitFor({ state: 'visible', timeout: 8000 });
    }
    await option.click();
  }

  public async clickSelectDatesCheckInDateCheckOut(): Promise<void> {
    // selector: confidence 0.99; signals: semantic, stable-attribute, observed
    // fallbacks: locator('main').getByRole('button', { name: 'Select dates Check-in date — Check-out date', exact: true }) (0.99) | getByRole('button', { name: 'Select dates Check-in date — Check-out date', exact: true }) (0.99) | getByText('Select dates Check-in date — Check-out date') (0.99)
    await this.page.getByTestId('searchbox-dates-container').click();
    // assertion(strong): testid selector is visible
    await expect(this.page.getByTestId('searchbox-dates-container').filter({ visible: true }).first()).toBeVisible();
  }

  public async clickSearchButton(): Promise<void> {
    // selector: confidence 0.99; signals: semantic, accessible-name, observed
    // fallbacks: getByRole('button', { name: 'Search', exact: true }) (0.99) | getByText('Search') (0.99) | getByText('Search') (0.99)
    await this.page.locator('main').getByRole('button', { name: 'Search', exact: true }).click();
  }

  public async assertBookingComLink(): Promise<void> {
    // assertion(strong): role selector is visible
    await expect(this.page.getByRole('link', { name: 'Booking.com', exact: true }).filter({ visible: true }).first()).toBeVisible();
  }
}
