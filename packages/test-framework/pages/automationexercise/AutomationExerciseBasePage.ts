import { BasePage } from '@core/BasePage';
import { Page, expect, Locator } from '@playwright/test';

type Role = Parameters<Page['getByRole']>[0];
type RoleOptions = Parameters<Page['getByRole']>[1];

/**
 * @pageIdentity AutomationExerciseBasePage
 * Shared Automation Exercise helpers (cookie banner, global nav).
 */
export abstract class AutomationExerciseBasePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async assertCountAtLeast(locator: Locator, minimum: number): Promise<void> {
    const n = await locator.count();
    expect(n).toBeGreaterThanOrEqual(minimum);
  }

  public async assertHeadingVisible(text: string | RegExp): Promise<void> {
    await expect(this.page.getByRole('heading', { name: text })).toBeVisible();
  }

  public async clickByRole(role: Role, options?: RoleOptions): Promise<void> {
    await this.page.getByRole(role, options).click();
  }

  async dismissCookieConsentIfPresent(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const consent = this.page.locator('.fc-consent-root');
      if ((await consent.count()) === 0) {
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
          break;
        }
      }
      const hidden = await consent
        .waitFor({ state: 'hidden', timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      if (hidden) {
        return;
      }
      await this.page
        .evaluate(() => {
          document.querySelector('.fc-consent-root')?.remove();
        })
        .catch(() => {});
      await this.page.waitForTimeout(200);
    }
  }

  async openProductsFromNav(): Promise<void> {
    await this.dismissCookieConsentIfPresent();
    await this.clickByRole('link', { name: 'Products' });
  }
}
