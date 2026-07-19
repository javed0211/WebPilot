import { BasePage } from '../../core/BasePage';
import { Page, expect } from '@playwright/test';

/**
 * @pageIdentity WikipediaSoftwareTestingPage
 * @urlPattern https://en.wikipedia.org/wiki/Software_testing
 */
export class WikipediaSoftwareTestingPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async assertSoftwareTesting(): Promise<void> {
    // assertion: heading is visible
    await expect(
      this.page.getByRole('heading', { name: 'Software testing' })
    ).toBeVisible();
  }

  public async assertFromWikipediaTheFreeEncyclopedia(): Promise<void> {
    // assertion: text is visible
    await expect(
      this.page.getByText('From Wikipedia, the free encyclopedia').first()
    ).toBeVisible();
  }

  public async assertArticle(): Promise<void> {
    // assertion: 'article' role is present
    await expect(this.page.getByRole('article')).toBeVisible();
  }

  public async assertWikipedia(): Promise<void> {
    // assertion: Wikipedia logo alt text is visible
    await expect(
      this.page.getByAltText('Wikipedia').first()
    ).toBeVisible();
  }

  public async assertThisPageWasLastEdited(): Promise<void> {
    // assertion: 'This page was last edited' text is visible
    await expect(
      this.page.getByText(/This page was last edited/).first()
    ).toBeVisible();
  }

  public async assertCategories(): Promise<void> {
    // assertion: 'Categories' heading is visible
    await expect(
      this.page.getByRole('heading', { name: 'Categories' }).first()
    ).toBeVisible();
  }

  public async assertReferencesSection(): Promise<void> {
    // assertion: 'References' heading is visible
    await expect(
      this.page.getByRole('heading', { name: 'References' }).first()
    ).toBeVisible();
  }

  public async assertExternalLinksSection(): Promise<void> {
    // assertion: 'External links' heading is visible
    await expect(
      this.page.getByRole('heading', { name: 'External links' }).first()
    ).toBeVisible();
  }

  public async assertRevisionHistory(): Promise<void> {
    // assertion: 'Revision history' link in the page actions (not in the DOM body text)
    // On Wikipedia, this is a link in the page actions menu, usually in the header
    await expect(
      this.page.getByRole('link', { name: 'View history' }).first()
    ).toBeVisible();
  }

  public async assertSeeAlsoSection(): Promise<void> {
    // assertion: 'See also' heading is visible
    await expect(
      this.page.getByRole('heading', { name: 'See also' }).first()
    ).toBeVisible();
  }

  public async captureCaptureScreenshotOfTheSoftwareTestingHeading(): Promise<void> {
    const heading = this.page.getByRole('heading', { name: 'Software testing' });
    await heading.screenshot({ path: 'runtime/test-results/software-testing-heading.png' });
  }

  public async capturePageScreenshot(): Promise<void> {
    await this.page.screenshot({ path: 'runtime/test-results/software-testing-page.png', fullPage: true });
  }
}
