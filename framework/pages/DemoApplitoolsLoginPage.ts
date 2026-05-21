import { BasePage } from '@core/BasePage';
import { expect } from '@playwright/test';
/**
 * DemoApplitoolsLoginPage
 * URL: https://demo.applitools.com/
 */
export class DemoApplitoolsLoginPage extends BasePage {
    static readonly urlPattern = /https:\/\/demo\.applitools\.com\/?$/;
    /** Locator for the login form region */
    loginForm() {
        return this.locator('form');
    }
    /** Username input (scoped to login form) */
    usernameInput() {
        return this.loginForm().getByPlaceholder('Enter your username');
    }
    /** Password input (scoped to login form) */
    passwordInput() {
        return this.loginForm().getByPlaceholder('Enter your password');
    }
    /** Sign in button (scoped to login form) */
    signInButton() {
        // Use id for strictness
        return this.loginForm().locator('#log-in');
    }
    async goto(): Promise<void> {
        await this.navigate('https://demo.applitools.com/');
    }
    async login(username: string, password: string): Promise<void> {
        await this.usernameInput().fill(username);
        await this.passwordInput().fill(password);
        await this.signInButton().click();
    }
    async assertOnLoginPage(): Promise<void> {
        await expect(this.loginForm()).toBeVisible();
        await expect(this.usernameInput()).toBeVisible();
        await expect(this.passwordInput()).toBeVisible();
        await expect(this.signInButton()).toBeVisible();
    }
}
