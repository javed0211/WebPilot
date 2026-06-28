import { Locator } from '@playwright/test';
import { BasePage } from '@core/BasePage';
/**
 * BookingBasePage
 * Shared Booking.com helpers derived from live browser execution.
 * Includes cookie consent handling and sign-in info dismissal workaround.
 */
export class BookingBasePage extends BasePage {
    protected cookieAcceptButton(): Locator {
        return this.locator('#onetrust-accept-btn-handler');
    }
    protected signInInfoDismissButton(): Locator {
        return this.getByRole('button', { name: /Dismiss sign-in info\.?/i });
    }
    public async dismissCookieConsentIfPresent(): Promise<void> {
        const accept = this.cookieAcceptButton();
        if (await accept.isVisible({ timeout: 3000 }).catch(() => false)) {
            await accept.click();
        }
    }
    public async dismissSignInInfoIfPresent(): Promise<void> {
        const dismiss = this.signInInfoDismissButton();
        if (await dismiss.isVisible({ timeout: 3000 }).catch(() => false)) {
            await dismiss.click();
        }
    }
    public async handleInitialOverlays(): Promise<void> {
        await this.dismissSignInInfoIfPresent();
        await this.dismissCookieConsentIfPresent();
    }
}
