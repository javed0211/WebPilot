import { test } from '@playwright/test';
import { DemoApplitoolsLoginPage } from '@pages/DemoApplitoolsLoginPage';
import { DemoApplitoolsAppPage } from '@pages/DemoApplitoolsAppPage';

test.describe('Demo Applitools - User Login Scenario', () => {
  test('User can log in and sees username and settings icons', async ({ page }) => {
    // RUNTIME INSIGHTS: url_flow: https://demo.applitools.com/ -> https://demo.applitools.com/app.html
    const loginPage = new DemoApplitoolsLoginPage(page);
    await loginPage.goto();
    await loginPage.assertOnLoginPage();
    await loginPage.login('Admin', 'Admin123');

    // After login, redirected to /app.html
    const appPage = new DemoApplitoolsAppPage(page);
    // Assert username 'Jack Gomez' is visible on the left sidebar
    await appPage.assertUsernameVisible('Jack Gomez');
    // Assert settings icons (notification bell, search, profile/user icon) are visible on the top bar
    await appPage.assertSettingsIconVisible();
  });
});
