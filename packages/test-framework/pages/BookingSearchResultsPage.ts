import { expect, Locator, Page } from '@playwright/test';
import { BookingBasePage } from './BookingBasePage';
export class BookingSearchResultsPage extends BookingBasePage {
    public readonly urlPattern = /https:\/\/www\.booking\.com\/searchresults\.html/;
    constructor(page: Page) {
        super(page);
    }
    private destinationField(): Locator {
        return this.locator('input[name="ss"]').first();
    }
    private resultsTitle(): Locator {
        return this.locator('h1').filter({ hasText: /London: .*properties found/i }).first();
    }
    private propertyCards(): Locator {
        return this.locator('[data-testid="property-card"], div[data-testid="title"]');
    }
    public async waitForLoaded(): Promise<void> {
        await this.waitForURL(/searchresults\.html/, { timeout: 30000 });
        await this.waitForLoadState('domcontentloaded');
    }
    public async assertLoaded(): Promise<void> {
        await this.assertUrl(this.urlPattern);
        await expect(this.destinationField()).toHaveValue(/London/i);
        await expect(this.resultsTitle()).toBeVisible();
        await this.assertCountAtLeast(this.propertyCards(), 1);
    }
    public async assertDestinationIsLondon(): Promise<void> {
        await expect(this.destinationField()).toHaveValue(/London/i);
    }
    public async assertAccommodationResultsVisible(): Promise<void> {
        await this.assertCountAtLeast(this.propertyCards(), 1);
    }
}
