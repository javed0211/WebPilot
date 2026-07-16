import { test, expect } from '@playwright/test';
import { GithubHomePage } from '../pages/github/GithubHomePage';
import { GithubSearchPage } from '../pages/github/GithubSearchPage';
import { GithubPlaywrightPage } from '../pages/github/GithubPlaywrightPage';
import { GithubIssuesPage } from '../pages/github/GithubIssuesPage';
import { GithubActionsPage } from '../pages/github/GithubActionsPage';
import { GithubSecurityPage } from '../pages/github/GithubSecurityPage';
import { GithubPulsePage } from '../pages/github/GithubPulsePage';

test('github_complex_multipage_verification', async ({ page }) => {
  const githubHomePage = new GithubHomePage(page);
  await githubHomePage.goto();
});
