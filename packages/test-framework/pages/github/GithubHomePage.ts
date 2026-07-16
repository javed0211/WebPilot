import { BasePage } from '../../core/BasePage';
import { Page, expect } from '@playwright/test';

/**
 * @pageIdentity GithubHomePage
 * @urlPattern https://github.com/
 */
export class GithubHomePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async goto(): Promise<void> {
    await this.navigate('https://github.com/');
  }

  public async clickSearchOrJumpToClickedButtonSearchOrJumpToAriaLabelSearchOrJumpTo(): Promise<void> {
    await this.page.getByRole('button', { name: 'Search or jump to…' }).click();
  }

  public async fillNavigateToHttpsGithubCom(): Promise<void> {
    await this.page.getByRole('combobox', { name: 'Search' }).fill('microsoft/playwright');
    await expect(this.page.getByRole('combobox', { name: 'Search' })).toHaveValue('microsoft/playwright');
  }

  public async clickNavigateToHttpsGithubCom(): Promise<void> {
    await this.page.locator('li[id="query-builder-test-result-0"]').click();
  }

  public async clickMicrosoftPlaywrightClickedAMicrosoftPlaywright(): Promise<void> {
    // Fix: Wait for the link to be visible and enabled before clicking
    const link = this.page.getByRole('link', { name: 'microsoft/playwright', exact: true });
    await link.waitFor({ state: 'visible', timeout: 10000 });
    await expect(link).toBeEnabled({ timeout: 10000 });
    await link.click();
  }

  public async clickIssues149ClickedAIssues149IdIssuesTab(): Promise<void> {
    await this.page.locator('a[id="issues-tab"]').click();
  }

  public async clickPullRequests21ClickedAPullRequests21IdPullRequestsTab(): Promise<void> {
    await this.page.locator('a[id="pull-requests-tab"]').click();
  }

  public async clickActionsClickedAActionsIdActionsTab(): Promise<void> {
    await this.page.locator('a[id="actions-tab"]').click();
  }

  public async clickSecurityAndQualityClickedASecurityAndQuality0IdSecurityAndQuality(): Promise<void> {
    await this.page.getByRole('link', { name: 'Security and quality' }).click();
  }

  public async clickInsightsClickedAInsightsIdInsightsTab(): Promise<void> {
    await this.page.locator('a[id="insights-tab"]').click();
  }

  public async click(): Promise<void> {
    await this.page.locator('a[id="code-tab"]').click();
  }

  public async clickCodeClickedACodeIdCodeTab(): Promise<void> {
    await this.page.locator('a[id="code-tab"]').click();
  }

  public async navigateToHttpsGithubComMicrosoftPlaywrightPulse(): Promise<void> {
    await this.page.screenshot({ path: 'test-results/codegen-page.png', fullPage: true });
  }

  public async assertVerifyGithubHomepageLoadsSuccessfully(): Promise<void> {
    await expect(this.page).toHaveURL('https://github.com/');
  }

  public async assertVerifyPageUrlContainsSearch(): Promise<void> {
    await expect(this.page).toHaveURL(/search/);
  }

  public async assertVerifyPageUrlContainsMicrosoftPlaywright(): Promise<void> {
    await expect(this.page).toHaveURL(/microsoft\/playwright/);
  }

  public async assertVerifyPageUrlContainsIssues(): Promise<void> {
    await expect(this.page).toHaveURL(/\/issues/);
  }

  public async assertVerifyPageUrlContainsPulls(): Promise<void> {
    await expect(this.page).toHaveURL(/\/pulls/);
  }

  public async assertVerifyPageUrlContainsActions(): Promise<void> {
    await expect(this.page).toHaveURL(/\/actions/);
  }

  public async assertVerifyPageUrlContainsSecurity(): Promise<void> {
    await expect(this.page).toHaveURL(/\/security/);
  }

  public async assertVerifyPageUrlContainsPulse(): Promise<void> {
    await expect(this.page).toHaveURL(/\/pulse/);
  }

  public async assertVerifyPageUrlContainsMicrosoftPlaywright1(): Promise<void> {
    await expect(this.page).toHaveURL(/microsoft\/playwright/);
  }
}
