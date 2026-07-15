import { test, expect } from '@playwright/test';
import { GithubcomHomePage } from '../pages/GithubcomHomePage';
import { GithubcomSearchPage } from '../pages/GithubcomSearchPage';
import { GithubcomPlaywrightPage } from '../pages/GithubcomPlaywrightPage';
import { GithubcomIssuesPage } from '../pages/GithubcomIssuesPage';
import { GithubcomActionsPage } from '../pages/GithubcomActionsPage';
import { GithubcomSecurityPage } from '../pages/GithubcomSecurityPage';
import { GithubcomPulsePage } from '../pages/GithubcomPulsePage';

test('GitHub Complex Multi-Page DOM Verification', async ({ page }) => {
  const githubcomHomePage = new GithubcomHomePage(page);
  await githubcomHomePage.goto();
  await githubcomHomePage.assertVerifyGithubHomepageLoadsSuccessfully();
  // assertion(strong): Text "Sign in" is visible
  await expect(page.getByText('Sign in').filter({ visible: true }).first()).toBeVisible();
  await githubcomHomePage.clickSearchOrJumpTo();
  // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
  // fallbacks: locator('input[name="query-builder-test"]') (0.62)
  await page.locator('input[id="query-builder-test"]').fill('microsoft/playwright');
  // assertion(strong): Form value equals entered value
  await expect(page.locator('input[id="query-builder-test"]').first()).toHaveValue('microsoft/playwright');
  await page.keyboard.press('Enter');
  // assertion(strong): URL contains "search"
  await expect(page).toHaveURL(/search/);
  // assertion(strong): Text "repositories" is visible
  await expect(page.getByText('repositories').filter({ visible: true }).first()).toBeVisible();
  // selector: confidence 0.99; signals: semantic, accessible-name, observed
  // fallbacks: getByRole('link', { name: 'microsoft/playwright', exact: true }) (0.94) | getByRole('button', { name: 'microsoft/playwright', exact: true }) (0.94) | getByText('microsoft/playwright') (0.68)
  await page.getByRole('link', { name: 'microsoft/playwright', exact: true }).first().click();
  // assertion(strong): URL contains "microsoft/playwright"
  await expect(page).toHaveURL(/microsoft\/playwright/);
  // assertion(strong): Text "Code" is visible
  await expect(page.getByText('Code').filter({ visible: true }).first()).toBeVisible();
  // assertion(strong): Text "README.md" is visible
  await expect(page.getByText('README.md').filter({ visible: true }).first()).toBeVisible();
  // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
  // fallbacks: getByRole('link', { name: 'Issues 149' }) (0.82) | getByRole('link', { name: 'Issues' }) (0.76) | getByRole('button', { name: 'Issues' }) (0.76)
  await page.locator('a[id="issues-tab"]').click();
  // assertion(strong): URL contains "/issues"
  await expect(page).toHaveURL(/\/issues/);
  // assertion(strong): Text "Issues" is visible
  await expect(page.getByText('Issues').filter({ visible: true }).first()).toBeVisible();
  // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
  // fallbacks: getByRole('link', { name: 'Pull requests 24' }) (0.82) | getByRole('link', { name: 'Pull requests' }) (0.86) | getByRole('button', { name: 'Pull requests' }) (0.86)
  await page.locator('a[id="pull-requests-tab"]').click();
  // assertion(strong): URL contains "/pulls"
  await expect(page).toHaveURL(/\/pulls/);
  // assertion(strong): Text "Pull requests" is visible
  await expect(page.getByText('Pull requests').filter({ visible: true }).first()).toBeVisible();
  // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
  // fallbacks: getByRole('link', { name: 'Actions' }) (0.76) | getByRole('button', { name: 'Actions' }) (0.76) | getByText('Actions') (0.68)
  await page.locator('a[id="actions-tab"]').click();
  // assertion(strong): URL contains "/actions"
  await expect(page).toHaveURL(/\/actions/);
  // assertion(strong): Text "Actions" is visible
  await expect(page.getByText('Actions').filter({ visible: true }).first()).toBeVisible();
  // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
  // fallbacks: getByRole('link', { name: 'Security and quality 0' }) (0.82) | getByRole('link', { name: 'Security' }) (0.76) | getByRole('button', { name: 'Security' }) (0.76)
  await page.locator('a[id="security-and-quality-tab"]').click();
  // assertion(strong): URL contains "/security"
  await expect(page).toHaveURL(/\/security/);
  // assertion(strong): Text "Security" is visible
  await expect(page.getByText('Security').filter({ visible: true }).first()).toBeVisible();
  // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
  // fallbacks: getByRole('link', { name: 'Insights' }) (0.76) | getByRole('button', { name: 'Insights' }) (0.76) | getByText('Insights') (0.68)
  await page.locator('a[id="insights-tab"]').click();
  // assertion(strong): URL contains "/pulse"
  await expect(page).toHaveURL(/\/pulse/);
  // assertion(strong): Text "Pulse" is visible
  await expect(page.getByText('Pulse').filter({ visible: true }).first()).toBeVisible();
  // selector: confidence 0.90; signals: semantic-css, stable-tab-id, observed
  // fallbacks: getByRole('link', { name: 'Code' }) (0.76) | getByRole('button', { name: 'Code' }) (0.76) | getByText('Code') (0.68)
  await page.locator('a[id="code-tab"]').click();
  // assertion(strong): URL contains "microsoft/playwright"
  await expect(page).toHaveURL(/microsoft\/playwright/);
  // assertion(strong): Text "README.md" is visible
  await expect(page.getByText('README.md').filter({ visible: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/codegen-page.png', fullPage: true });
});
