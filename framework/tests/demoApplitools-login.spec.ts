import { test } from '@playwright/test';
import { DemoApplitoolsLoginPage } from '@pages/DemoApplitoolsLoginPage';
import { DemoApplitoolsAppPage } from '@pages/DemoApplitoolsAppPage';

// [url_flow] Pages visited: https://demo.applitools.com/ -> https://demo.applitools.com/app.html

test.describe('Demo Applitools - User Login Scenario', () => {
  test('User can log in and sees username and settings icon', async ({ page }) => {
    // Step 1: Go to login page
    const loginPage = new DemoApplitoolsLoginPage(page);
    await loginPage.goto();
    await loginPage.assertOnLoginPage();

    // Step 2: Fill credentials and sign in
    await loginPage.login('Admin', 'Admin123');

    // Step 3: Arrive at app page, verify username and settings icon
    const appPage = new DemoApplitoolsAppPage(page);
    await appPage.assertUsernameVisible('Jack Gomez');
    await appPage.assertSettingsIconVisible();
  });
});
