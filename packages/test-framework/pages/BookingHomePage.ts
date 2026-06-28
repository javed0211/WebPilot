import { expect, Locator, Page } from '@playwright/test';
import { BookingBasePage } from './BookingBasePage';
import { BookingSearchResultsPage } from './BookingSearchResultsPage';
export class BookingHomePage extends BookingBasePage {
    public readonly urlPattern = /https:\/\/www\.booking\.com\/(\?.*)?$/;
    constructor(page: Page) {
        super(page);
    }
    private headerLogo(): Locator {
        return this.getByRole('link', { name: /Booking\.com/i });
    }
    private searchForm(): Locator {
        return this.locator('#SearchBoxDesktop form').first();
    }
    private destinationInput(): Locator {
        return this.searchForm().locator('input[name="ss"]');
    }
    private autocompleteList(): Locator {
        return this.locator('ul[role="listbox"], ul[id="autocomplete-results"]').first();
    }
    private autocompleteOptionForDestination(destination: string): Locator {
        return this.autocompleteList()
            .locator('li[role="option"]')
            .filter({ hasText: new RegExp(destination, 'i') })
            .first();
    }
    private dateCell(date: string): Locator {
        return this.locator(`[data-date="${date}"][role="checkbox"]`).first();
    }
    private searchButton(): Locator {
        return this.searchForm().getByRole('button', { name: /^Search$/i });
    }
    public async goto(): Promise<void> {
        await this.navigate('https://www.booking.com/');
        await this.waitForLoadState('domcontentloaded');
        await this.handleInitialOverlays();
    }
    public async assertLoaded(): Promise<void> {
        await this.assertUrl(this.urlPattern);
        await expect(this.headerLogo()).toBeVisible();
        await expect(this.searchForm()).toBeVisible();
        await expect(this.destinationInput()).toBeVisible();
    }
    public async searchHotels(destination: string, checkIn: string, checkOut: string): Promise<BookingSearchResultsPage> {
        await this.handleInitialOverlays();
        await this.fill(this.destinationInput(), destination);
        await this.waitForTimeout(2000);
        await expect(this.autocompleteList()).toBeVisible();
        await this.autocompleteOptionForDestination(destination).click();
        await this.dateCell(checkIn).click();
        await this.dateCell(checkOut).click();
        await this.searchButton().click();
        const resultsPage = new BookingSearchResultsPage(this.getPage());
        await resultsPage.waitForLoaded();
        return resultsPage;
    }
}
