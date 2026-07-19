import { BasePage } from '../../core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity AmazonHomePage
 * @urlPattern https://www.amazon.com/
 */
export class AmazonHomePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async goto(): Promise<void> {
    await this.navigate('https://www.amazon.com/');
  }

  public async clickContinueShoppingButton(): Promise<void> {
    // Amazon sometimes shows a 'Continue shopping' button in a modal/banner, but often it does not appear for new/clean sessions.
    // Instead of always waiting for it, only click if it is visible within a short timeout.
    const button = this.page.getByRole('button', { name: 'Continue shopping', exact: true });
    if (await button.isVisible({ timeout: 3000 })) {
      await button.click();
    }
    // else: proceed, as the button is not present for all users/regions/sessions.
  }

  public async fillSearchAmazonSearchbox(): Promise<void> {
    // selector: confidence 0.99; signals: semantic-css, stable-tab-id, observed
    // fallbacks: locator('header').getByRole('searchbox', { name: 'Search Amazon', exact: true }) (0.99) | getByRole('searchbox', { name: 'Search Amazon', exact: true }) (0.99) | getByText('Search Amazon') (0.99)
    await this.page.locator('input[id="twotabsearchtextbox"]').fill('wireless mouse');
    // assertion(strong): Form value equals entered value
    await expect(this.page.locator('input[id="twotabsearchtextbox"]')).toHaveValue('wireless mouse');
  }

  public async clickGoButton(): Promise<void> {
    // selector: confidence 0.99; signals: semantic-css, stable-tab-id, observed
    // fallbacks: locator('header').getByRole('button', { name: 'Go', exact: true }) (0.99) | getByRole('button', { name: 'Go', exact: true }) (0.99) | locator('//input[@id=\'nav-search-submit-button\']') (0.99)
    await this.page.locator('input[id="nav-search-submit-button"]').click();
  }
}
