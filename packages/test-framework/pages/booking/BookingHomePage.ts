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

  public async clickAccept(): Promise<void> {
    await this.dismissOverlays();
  }

  public async clickDismissSignIn(): Promise<void> {
    await this.dismissOverlays();
  }

  public async fillDestination(): Promise<void> {
    await this.dismissOverlays();
    const destination = this.page
      .locator('input[name="ss"], #searchbox-horizontal-destination-input, input[type="search"]')
      .first();
    await destination.waitFor({ state: 'visible' });
    await destination.fill('London');
  }

  public async clickLondonOption(): Promise<void> {
    const option = () => this.page
        .locator('[role="listbox"] [role="option"], [data-testid*="autocomplete"] li, li[id^="autocomplete-result"]')
        .filter({ hasText: /London/i })
        .first();
    // Booking can display cookie/Genius overlays several seconds after load.
    // Re-open autocomplete after each dismissal rather than waiting behind it.
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.dismissOverlays();
      await this.fillDestination();
      if (await option().isVisible({ timeout: 4000 }).catch(() => false)) {
        await option().click();
        return;
      }
    }
    await option().waitFor({ state: 'visible', timeout: 8000 });
    await option().click();
  }

  public async selectCheckInDate(): Promise<void> {
    await this.selectRelativeDate(7);
  }

  public async selectCheckOutDate(): Promise<void> {
    await this.selectRelativeDate(9);
  }

  public async clickSearch(): Promise<void> {
    await this.page.getByRole('button', { name: 'Search' }).click();
  }

  public async assertBooking(): Promise<void> {
    await expect(this.page.getByRole('link', { name: /Booking\.com/i }).first()).toBeVisible();
    await expect(this.page.locator('input[name="ss"], #searchbox-horizontal-destination-input').first()).toBeVisible();
  }

  private async selectRelativeDate(offsetDays: number): Promise<void> {
    const target = new Date();
    target.setHours(12, 0, 0, 0);
    target.setDate(target.getDate() + offsetDays);
    const iso = target.toISOString().slice(0, 10);
    let date = this.page.locator(`[data-date="${iso}"]`).first();
    if (!(await date.isVisible().catch(() => false))) {
      const picker = this.page
        .locator('[data-testid="searchbox-dates-container"], [data-testid="date-display-field-start"]')
        .first();
      if (await picker.isVisible().catch(() => false)) await picker.click();
    }
    for (let month = 0; month < 3 && !(await date.isVisible().catch(() => false)); month++) {
      const next = this.page.getByRole('button', { name: /next month|next/i }).first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
      date = this.page.locator(`[data-date="${iso}"]`).first();
    }
    await date.click();
  }

  private async dismissOverlays(): Promise<void> {
    for (let pass = 0; pass < 2; pass++) {
      const cookieChoice = this.page
        .getByRole('button', { name: /^(accept|decline)$/i })
        .first();
      if (await cookieChoice.isVisible({ timeout: 2000 }).catch(() => false)) {
        await cookieChoice.click({ timeout: 2000 }).catch(() => undefined);
        await this.page.waitForTimeout(250);
      }

      const geniusDismiss = this.page
        .locator('button[aria-label*="Dismiss" i], button[aria-label*="Close" i]')
        .first();
      if (await geniusDismiss.isVisible({ timeout: 1500 }).catch(() => false)) {
        await geniusDismiss.click({ timeout: 2000 }).catch(() => undefined);
        await this.page.waitForTimeout(250);
        continue;
      }
      const namedDismiss = this.page.getByRole('button', { name: /dismiss sign|close/i }).first();
      if (await namedDismiss.isVisible({ timeout: 750 }).catch(() => false)) {
        await namedDismiss.click({ timeout: 2000 }).catch(() => undefined);
        await this.page.waitForTimeout(250);
      }
    }
  }


  public async waitForPage(): Promise<void> {
      await this.page.waitForLoadState('networkidle');
    }

  public async capturePageScreenshot(): Promise<void> {
      await this.page.screenshot({ path: 'test-results/codegen-page.png', fullPage: true });
    }

  public async waitForPage1(): Promise<void> {
      await this.page.waitForLoadState('networkidle');
    }
}
