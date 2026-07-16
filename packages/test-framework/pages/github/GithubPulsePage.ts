import { BasePage } from '../../core/BasePage';
import { Page } from '@playwright/test';

/**
 * @pageIdentity GithubPulsePage
 * @urlPattern https://github.com/microsoft/playwright/pulse
 */
export class GithubPulsePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async clickCodeClickedACodeIdCodeTab(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByRole('link', { name: 'Code' }) (0.76) | getByText('Code') (0.68) | locator('a[href="/microsoft/playwright"]') (0.64)
    await this.page.locator('a[id="code-tab"]').click();
  }

  public async navigateToHttpsGithubComMicrosoftPlaywrightPulse(): Promise<void> {
    await this.page.screenshot({ path: 'test-results/codegen-page.png', fullPage: true });
  }
}
