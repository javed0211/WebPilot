import { Locator } from '@playwright/test';
import { BasePage } from '@core/BasePage';

export class DemoApplitoolsAppPage extends BasePage {
    static readonly urlPattern = /https:\/\/demo\.applitools\.com\/app\.html$/;

    private pageShell(): Locator {
        return this.locator('body');
    }

    private sidebar(): Locator {
        return this.locator('.menu-w .logged-user-w');
    }

    private topBar(): Locator {
        return this.locator('.top-bar');
    }

    private loggedInUserName(): Locator {
        return this.sidebar().locator('.logged-user-name');
    }

    private topBarIcons(): Locator {
        return this.topBar().locator('i.os-icon');
    }

    private settingsIcon(): Locator {
        return this.topBar().locator('i.os-icon.os-icon-ui-46');
    }

    public async assertLoaded(): Promise<void> {
        await this.assertUrl(DemoApplitoolsAppPage.urlPattern);
        await this.assertElementVisible(this.pageShell());
        await this.assertElementVisible(this.sidebar());
        await this.assertElementVisible(this.topBar());
    }

    public async assertUsernameVisible(username: string): Promise<void> {
        await this.assertElementVisible(this.loggedInUserName());
        await this.assertTextPresent(this.loggedInUserName(), username);
    }

    public async assertLoggedInUserVisible(username: string): Promise<void> {
        await this.assertUsernameVisible(username);
    }

    public async assertSettingsIconVisible(): Promise<void> {
        await this.assertElementVisible(this.topBar());
        await this.assertCountAtLeast(this.topBarIcons(), 1);
        await this.assertElementVisible(this.settingsIcon());
    }

    public async assertNoSettingsIconInTopBar(): Promise<void> {
        await this.assertElementHidden(this.settingsIcon());
    }
}
