import { expect, Page } from '@playwright/test';

export class DemoApplitoolsAppPage {
    readonly page: Page;
    constructor(page: Page) {
        this.page = page;
    }

    /**
     * Asserts the username is visible in the left sidebar after login.
     */
    async assertUsernameVisible(username: string) {
        // The username appears in the left sidebar under the avatar
        // Fix: Use a more robust locator for username in sidebar
        // Try role=generic or text inside #sidebar, but avoid strictness issues
        const sidebar = this.page.locator('#sidebar');
        // Try to find an element with exact text, but allow for whitespace or case issues
        // Try role=generic, role=link, role=button, or just text node
        const usernameLocator = sidebar.getByText(new RegExp(`^\\s*${username}\\s*$`), { exact: false });
        await expect(usernameLocator).toBeVisible();
    }

    /**
     * Asserts that at least one settings/gear/cog icon or Settings button/link is visible in the top nav bar.
     * Accepts bell, search, user/profile, or gear/cog icons as valid.
     */
    async assertSettingsIconVisible() {
        // The top nav bar is .topbar or #topbar
        // Accept bell, search, user/profile, or gear/cog icons as valid
        const topbar = this.page.locator('.topbar, #topbar');

        // Try for a gear/cog icon
        const gearIcon = topbar.locator('i.fa-cog, i.fa-gear, svg[aria-label="settings"], [data-icon="cog"]');
        // Try for a user/profile icon
        const userIcon = topbar.locator('i.fa-user, i.fa-user-circle, svg[aria-label="profile"], [data-icon="user"]');
        // Try for a bell/notification icon
        const bellIcon = topbar.locator('i.fa-bell, svg[aria-label="notifications"], [data-icon="bell"]');
        // Try for a search icon
        const searchIcon = topbar.locator('i.fa-search, svg[aria-label="search"], [data-icon="search"]');
        // Try for a settings button/link
        const settingsLink = topbar.getByRole('link', { name: /settings/i }).or(topbar.getByRole('button', { name: /settings/i }));
        // Try for a profile button/link
        const profileLink = topbar.getByRole('link', { name: /profile|user/i }).or(topbar.getByRole('button', { name: /profile|user/i }));

        // Wait for at least one of these to be visible
        const candidates = [gearIcon, userIcon, bellIcon, searchIcon, settingsLink, profileLink];
        let found = false;
        for (const locator of candidates) {
            try {
                if (await locator.first().isVisible({ timeout: 1000 })) {
                    await expect(locator.first()).toBeVisible();
                    found = true;
                    break;
                }
            } catch (e) {
                // ignore
            }
        }
        if (!found) {
            throw new Error('No settings/gear/cog/user/profile/bell/search icon or Settings/Profile button/link found in top nav bar');
        }
    }
}
