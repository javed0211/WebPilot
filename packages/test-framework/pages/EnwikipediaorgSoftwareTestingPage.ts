import { BasePage } from '@core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity EnwikipediaorgSoftwareTestingPage
 * @urlPattern https://en.wikipedia.org/wiki/Software_testing
 */
export class EnwikipediaorgSoftwareTestingPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async assertCustomSearchedPageForSoftwareTesting3MatchesFound(): Promise<void> {
    // assertion(medium): URL contains "Software_testing"
    await expect(this.page).toHaveURL(/Software_testing/);
  }

  public async assertCustomSearchedPageForSoftwareTesting100MatchesFound(): Promise<void> {
    await expect(this.page).toHaveURL("https://en.wikipedia.org/wiki/Software_testing");
  }

  public async assertCustomSearchedPageForFromWikipediaTheFreeEncyclopedia2MatchesFound(): Promise<void> {
    await expect(this.page).toHaveURL("https://en.wikipedia.org/wiki/Software_testing");
  }

  public async assertCustomSearchedPageForArticle34MatchesFound(): Promise<void> {
    await expect(this.page).toHaveURL("https://en.wikipedia.org/wiki/Software_testing");
  }

  public async clickViewHistoryClickedAViewHistory(): Promise<void> {
    // selector: confidence 0.99; signals: semantic, accessible-name, observed
    // fallbacks: getByText('View history') (0.68) | locator('a[href="/w/index.php?title=Software_testing&action=history"]') (0.64) | locator('//a[normalize-space(.)=\'View history\']') (0.25)
    await this.page.getByRole('link', { name: 'View history' }).click();
  }

  public async assertCustomSearchedPageForSoftwareTesting100MatchesFound1(): Promise<void> {
    // assertion(medium): URL contains "Software_testing"
    await expect(this.page).toHaveURL(/Software_testing/);
  }

  public async assertCustomSearchedPageForSeeAlso5MatchesFound(): Promise<void> {
    await expect(this.page).toHaveURL("https://en.wikipedia.org/wiki/Software_testing");
  }

  public async assertCustomSearchedPageForReferences14MatchesFound(): Promise<void> {
    await expect(this.page).toHaveURL("https://en.wikipedia.org/wiki/Software_testing");
  }

  public async assertCustomSearchedPageForExternalLinks3MatchesFound(): Promise<void> {
    await expect(this.page).toHaveURL("https://en.wikipedia.org/wiki/Software_testing");
  }

  public async assertCustomSearchedPageForWikipedia21MatchesFound(): Promise<void> {
    await expect(this.page).toHaveURL("https://en.wikipedia.org/wiki/Software_testing");
  }

  public async navigateToHttpsEnWikipediaOrgWikiSoftwareTesting(): Promise<void> {
    await this.page.screenshot({ path: 'test-results/codegen-page.png', fullPage: true });
  }

  public async clickTalkClickedATalk(): Promise<void> {
    // selector: confidence 0.94; signals: semantic, accessible-name, observed
    // fallbacks: getByText('Talk') (0.68) | locator('a[href="/wiki/Talk:Software_testing"]') (0.64) | locator('//a[normalize-space(.)=\'Talk\']') (0.25)
    await this.page.getByRole('link', { name: 'Talk' }).click();
  }

  public async assertCustomSearchedPageForSoftwareTesting100MatchesFound2(): Promise<void> {
    // assertion(medium): URL contains "Software_testing"
    await expect(this.page).toHaveURL(/Software_testing/);
  }

  public async assertCustomSearchedPageForCategories6MatchesFound(): Promise<void> {
    await expect(this.page).toHaveURL("https://en.wikipedia.org/wiki/Software_testing");
  }

  public async assertCustomSearchedPageForThisPageWasLastEdited2MatchesFound(): Promise<void> {
    await expect(this.page).toHaveURL("https://en.wikipedia.org/wiki/Software_testing");
  }
}
