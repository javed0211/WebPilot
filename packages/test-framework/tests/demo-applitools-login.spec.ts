import { test } from '@playwright/test';
import { DemoApplitoolsLoginPage } from '@pages/DemoApplitoolsLoginPage';

test('User Login Scenario', async ({ page }) => {
  const loginPage = new DemoApplitoolsLoginPage(page);

  await loginPage.goto();

  const appPage = await loginPage.login('Admin', 'Admin123');

  await appPage.assertLoggedInUserVisible('Jack Gomez');
  await appPage.assertSettingsIconVisible();
});
