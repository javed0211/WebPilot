import { test } from '@playwright/test';
import { DemoApplitoolsLoginPage } from '@pages/DemoApplitoolsLoginPage';
import { DemoApplitoolsAppPage } from '@pages/DemoApplitoolsAppPage';

// [url_flow] Pages visited: https://demo.applitools.com/ -> https://demo.applitools.com/app.html

test.describe('Demo Applitools - User Login Scenario', () => {
  test('should login and show username in sidebar, no settings icon in top bar', async ({ page }) => {
    // Step 1: Go to login page
    const loginPage = new DemoApplitoolsLoginPage(page);
    await loginPage.goto();
    await loginPage.assertOnLoginPage();

    // Step 2: Fill credentials and sign in
    await loginPage.login('Admin', 'Admin123');

    // Step 3: On app page, verify username and absence of settings icon
    const appPage = new DemoApplitoolsAppPage(page);
    await appPage.assertUsernameVisible('Jack Gomez');
    await appPage.assertNoSettingsIconInTopBar();
  });
});
