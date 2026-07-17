import { BasePage } from '../../core/BasePage';
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * @pageIdentity WikipediaSoftwareTestingPage
 * @urlPattern https://en.wikipedia.org/wiki/Software_testing
 */
export class WikipediaSoftwareTestingPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async clickViewHistoryLink(): Promise<void> {
    // selector: confidence 0.99; signals: semantic, accessible-name, observed
    // fallbacks: locator('a[href="/w/index.php?title=Software_testing&action=history"]') (0.64) | getByText('View history') (0.68) | getByRole('link', { name: 'View history', exact: true }) (0.99)
    // Fix: strict mode violation - two elements match, so disambiguate by picking the first
    await this.page.locator('main').getByRole('link', { name: 'View history', exact: true }).first().click();
  }

  public async capturePageScreenshot(): Promise<void> {
    await this.page.screenshot({ path: 'test-results/codegen-page.png', fullPage: true });
  }

  public async clickTalkLink(): Promise<void> {
    // selector: confidence 0.94; signals: semantic, accessible-name, observed
    // fallbacks: getByRole('link', { name: 'Talk', exact: true }) (0.94) | getByText('Talk') (0.68) | locator('a[href="/wiki/Talk:Software_testing"]') (0.64)
    await this.page.locator('nav').getByRole('link', { name: 'Talk', exact: true }).click();
  }

  public async assertSoftwareTesting(): Promise<void> {
    // assertion(strong): text selector is visible
    await expect(this.page.getByText('Software testing').filter({ visible: true }).first()).toBeVisible();
  }

  public async assertFromWikipediaTheFreeEncyclopedia(): Promise<void> {
    // assertion(strong): text selector is visible
    await expect(this.page.getByText('From Wikipedia, the free encyclopedia').filter({ visible: true }).first()).toBeVisible();
  }

  public async assertArticle(): Promise<void> {
    // assertion(strong): text selector is visible
    await expect(this.page.getByText('Article').filter({ visible: true }).first()).toBeVisible();
  }

  public async assertRevisionHistory(): Promise<void> {
    // assertion(strong): text selector is visible
    await expect(this.page.getByText('Revision history').filter({ visible: true }).first()).toBeVisible();
  }

  public async assertSeeAlsoSection(): Promise<void> {
    // assertion(strong): text selector is visible
    await expect(this.page.getByText('See also section').filter({ visible: true }).first()).toBeVisible();
  }

  public async assertReferencesSection(): Promise<void> {
    // assertion(strong): text selector is visible
    await expect(this.page.getByText('References section').filter({ visible: true }).first()).toBeVisible();
  }

  public async assertExternalLinksSection(): Promise<void> {
    // assertion(strong): text selector is visible
    await expect(this.page.getByText('External links section').filter({ visible: true }).first()).toBeVisible();
  }

  public async assertWikipedia(): Promise<void> {
    // assertion(strong): text selector is visible
    await expect(this.page.getByText('Wikipedia').filter({ visible: true }).first()).toBeVisible();
  }

  public async captureCaptureScreenshotOfTheSoftwareTestingHeading(): Promise<void> {
    // selector: confidence 0.68; signals: visible-text, observed
    await this.page.getByText('Capture screenshot of the "Software testing" heading').first().scrollIntoViewIfNeeded();
    await this.page.getByText('Capture screenshot of the "Software testing" heading').first().screenshot({ path: 'test-results/codegen-section.png' });
  }

  public async assertCategories(): Promise<void> {
    // assertion(strong): text selector is visible
    await expect(this.page.getByText('Categories').filter({ visible: true }).first()).toBeVisible();
  }

  public async assertThisPageWasLastEdited(): Promise<void> {
    // assertion(strong): text selector is visible
    await expect(this.page.getByText('This page was last edited').filter({ visible: true }).first()).toBeVisible();
  }
}
