import { BasePage } from '../../core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity BookingSearchResultsPage
 * @urlPattern https://www.booking.com/searchresults.en-gb.html?ss=London%2C+Greater+London%2C+United+Kingdom&efdco=1&label=gen173nr-10CAEoggI46AdIM1gEaFCIAQGYATO4AQfIAQzYAQPoAQH4AQGIAgGoAgG4Av2H6NIGwAIB0gIkYmUyZjI3NGEtMjBhZC00NmQ2LWJiYjgtZDRkYjQ3OWUzMWI02AIB4AIB&aid=304142&lang=en-gb&sb=1&src_elem=sb&src=index&dest_id=-2601889&dest_type=city&ac_position=0&ac_click_type=b&ac_langcode=xu&ac_suggestion_list_length=6&search_selected=true&search_pageview_id=f69649bfdd6001de&ac_meta=GhBmNjk2NDliZmRkNjAwMWRlIAAoATICeHU6BkxvbmRvbg%3D%3D&group_adults=2&no_rooms=1&group_children=0
 */
export class BookingSearchResultsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async assertSearchResultsPage(): Promise<void> {
    // assertion(strong): URL contains "search"
    await expect(this.page).toHaveURL(/search/);
  }

  public async assertDestinationIsLondonAndAccommodationResults(): Promise<void> {
    // assertion(strong): URL contains "London"
    await expect(this.page).toHaveURL(/London/);
  }
}
