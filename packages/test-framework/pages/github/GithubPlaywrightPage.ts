import { BasePage } from '../../core/BasePage';
import { Page } from '@playwright/test';

/**
 * @pageIdentity GithubPlaywrightPage
 * @urlPattern https://github.com/microsoft/playwright
 */
export class GithubPlaywrightPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async clickIssues149ClickedAIssues149IdIssuesTab(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByRole('link', { name: 'Issues 149' }) (0.82) | getByText('Issues 149') (0.68) | locator('a[href="/microsoft/playwright/issues"]') (0.64)
    await this.page.locator('a[id="issues-tab"]').click();
  }

  public async clickPullRequests21ClickedAPullRequests21IdPullRequestsTab(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByRole('link', { name: 'Pull requests 21' }) (0.82) | getByText('Pull requests 21') (0.68) | locator('a[href="/microsoft/playwright/pulls"]') (0.64)
    await this.page.locator('a[id="pull-requests-tab"]').click();
  }

  public async clickActionsClickedAActionsIdActionsTab(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByRole('link', { name: 'Actions' }) (0.76) | getByText('Actions') (0.68) | locator('a[href="/microsoft/playwright/actions"]') (0.64)
    await this.page.locator('a[id="actions-tab"]').click();
  }

  public async clickSecurityAndQualityClickedASecurityAndQuality0IdSecurityAndQuality(): Promise<void> {
    // selector: confidence 0.99; signals: semantic, accessible-name, observed
    // fallbacks: locator('a[id="security-and-quality-tab"]') (0.90) | getByText('Security and quality') (0.68) | locator('a[href="/microsoft/playwright/security"]') (0.64)
    await this.page.getByRole('link', { name: 'Security and quality' }).click();
  }

  public async clickInsightsClickedAInsightsIdInsightsTab(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: getByRole('link', { name: 'Insights' }) (0.76) | getByText('Insights') (0.68) | locator('a[href="/microsoft/playwright/pulse"]') (0.64)
    await this.page.locator('a[id="insights-tab"]').click();
  }

  public async click(): Promise<void> {
    // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
    // fallbacks: locator('a[href="/microsoft/playwright"]') (0.64) | locator('//a[@id=\'code-tab\']') (0.25) | locator('//a[@href=\'/microsoft/playwright\']') (0.25)
    await this.page.locator('a[id="code-tab"]').click();
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
