import { BasePage } from '@core/BasePage';
import { Page } from '@playwright/test';

/**
 * @pageIdentity AutomationExerciseBasePage
 * Shared Automation Exercise helpers (cookie banner, global nav).
 */
export abstract class AutomationExerciseBasePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async dismissCookieConsentIfPresent(): Promise<void> {
    const consent = this.page.locator('.fc-consent-root');
    if (!(await consent.isVisible().catch(() => false))) {
      return;
    }
    const acceptSelectors = [
      this.page.locator('button.fc-cta-consent'),
      this.page.getByRole('button', { name: 'Consent', exact: true }),
      this.page.getByRole('button', { name: /accept all|accept|agree/i }),
    ];
    for (const accept of acceptSelectors) {
      if (await accept.first().isVisible().catch(() => false)) {
        await accept.first().click({ force: true });
        await consent.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
        return;
      }
    }
  }

  async openProductsFromNav(): Promise<void> {
    await this.dismissCookieConsentIfPresent();
    await this.clickByRole('link', { name: 'Products' });
  }
}
