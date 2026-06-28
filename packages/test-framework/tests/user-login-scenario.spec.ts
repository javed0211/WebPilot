import { test } from '@playwright/test';
import { DemoApplitoolsLoginPage } from '@pages/DemoApplitoolsLoginPage';
import { DemoApplitoolsAppPage } from '@pages/DemoApplitoolsAppPage';

test('User Login Scenario', async ({ page }) => {
  const loginPage = new DemoApplitoolsLoginPage(page);
  const appPage = new DemoApplitoolsAppPage(page);

  await loginPage.goto();
  await loginPage.login('Admin', 'Admin123');

  await appPage.assertLoaded();
  await appPage.assertLoggedInUserVisible('Jack Gomez');
  await appPage.assertSettingsIconVisible();
});
