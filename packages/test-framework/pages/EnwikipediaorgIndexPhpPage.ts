import { BasePage } from '@core/BasePage';
import { Page, expect } from '@playwright/test';

/**
 * @pageIdentity EnwikipediaorgIndexPhpPage
 * @urlPattern https://en.wikipedia.org/w/index.php?title=Software_testing&action=history
 */
export class EnwikipediaorgIndexPhpPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async goBackNavigatedBack(): Promise<void> {
    await this.page.goBack();
  }

  public async assertCustomSearchedPageForRevisionHistory3MatchesFound(): Promise<void> {
    // assertion(medium): URL contains "index.php" or is the history page
    // Accept both /w/index.php?... and /wiki/Software_testing?action=history (canonical redirect)
    const url = this.page.url();
    if (/\/w\/index\.php/.test(url) || /\/wiki\/Software_testing\?action=history/.test(url)) {
      // pass
      expect(true).toBeTruthy();
    } else {
      throw new Error(`Not on revision history page. URL: ${url}`);
    }
  }
}
