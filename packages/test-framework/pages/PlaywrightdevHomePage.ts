import { BasePage } from '@core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';
/**
 * @pageIdentity PlaywrightdevHomePage
 * @urlPattern https://playwright.dev/
 */
export class PlaywrightdevHomePage extends BasePage {
    constructor(page: Page) {
        super(page);
    }
    public async goto(): Promise<void> {
        await this.navigate('https://playwright.dev/');
    }
    public async assertVerifyPlaywrightHomepageLoadsSuccessfully(): Promise<void> {
        // assertion(strong): Success text "Success" is visible
        await expect(this.page.getByText('Success')).toBeVisible();
    }
    public async clickGetStartedButton(): Promise<void> {
        // selector: confidence 0.94; signals: semantic, accessible-name, observed
        // fallbacks: getByText('Get started') (0.68) | locator('a[href="/docs/intro"]') (0.42)
        await this.page.getByRole('link', { name: 'Get started' }).click();
    }
    public async assertVerifyGettingStartedPageIsDisplayed(): Promise<void> {
        // assertion(medium): URL contains "intro"
        await expect(this.page).toHaveURL(/intro/);
    }
}
