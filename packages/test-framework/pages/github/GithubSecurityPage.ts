import { BasePage } from '../../core/BasePage';
import { Page } from '@playwright/test';

/**
 * @pageIdentity GithubSecurityPage
 * @urlPattern https://github.com/microsoft/playwright/security
 */
export class GithubSecurityPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async clickInsightsClickedAInsightsIdInsightsTab(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByRole('link', { name: 'Insights' }) (0.76) | getByText('Insights') (0.68) | locator('a[href="/microsoft/playwright/pulse"]') (0.64)
    // Fix: Wait for the Insights tab to be visible before clicking, and fallback to getByRole if not found
    const tab = this.page.locator('a[id="insights-tab"]');
    if (await tab.isVisible({ timeout: 5000 })) {
      await tab.click();
    } else {
      // fallback to getByRole
      await this.page.getByRole('link', { name: 'Insights' }).click();
    }
  }

  public async click(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: locator('a[href="/microsoft/playwright"]') (0.64) | locator('//a[@id=\'code-tab\']') (0.25) | locator('//a[@href=\'/microsoft/playwright\']') (0.25)
    await this.page.locator('a[id="code-tab"]').click();
  }
}
