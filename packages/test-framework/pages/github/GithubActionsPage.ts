import { BasePage } from '../../core/BasePage';
import { Page } from '@playwright/test';

/**
 * @pageIdentity GithubActionsPage
 * @urlPattern https://github.com/microsoft/playwright/actions
 */
export class GithubActionsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async clickSecurityAndQualityClickedASecurityAndQuality0IdSecurityAndQuality(): Promise<void> {
    // selector: confidence 0.99; signals: semantic, accessible-name, observed
    // fallbacks: locator('a[id="security-and-quality-tab"]') (0.90) | getByText('Security and quality') (0.68) | locator('a[href="/microsoft/playwright/security"]') (0.64)
    await this.page.getByRole('link', { name: 'Security and quality' }).click();
  }
}
