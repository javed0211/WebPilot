import { expect, Locator } from '@playwright/test';
import { BasePage } from '@core/BasePage';
import { DemoApplitoolsAppPage } from '@pages/DemoApplitoolsAppPage';

/**
 * DemoApplitoolsLoginPage
 * URL: https://demo.applitools.com/
 */
export class DemoApplitoolsLoginPage extends BasePage {
    static readonly urlPattern = /https:\/\/demo\.applitools\.com\/?$/;

    /** Locator for the login form region */
    loginForm(): Locator {
        return this.locator('form');
    }

    /** Username input (scoped to login form) */
    usernameInput(): Locator {
        return this.loginForm().getByPlaceholder('Enter your username');
    }

    /** Password input (scoped to login form) */
    passwordInput(): Locator {
        return this.loginForm().getByPlaceholder('Enter your password');
    }

    /** Sign in button (scoped to login form) */
    signInButton(): Locator {
        return this.loginForm().locator('#log-in');
    }

    async goto(): Promise<void> {
        await this.navigate('https://demo.applitools.com/');
    }

    async login(username: string, password: string): Promise<DemoApplitoolsAppPage> {
        await this.usernameInput().fill(username);
        await this.passwordInput().fill(password);
        await this.signInButton().click();

        const appPage = new DemoApplitoolsAppPage(this.page);
        await appPage.assertLoaded();
        return appPage;
    }

    async assertOnLoginPage(): Promise<void> {
        await expect(this.loginForm()).toBeVisible();
        await expect(this.usernameInput()).toBeVisible();
        await expect(this.passwordInput()).toBeVisible();
        await expect(this.signInButton()).toBeVisible();
    }
}
