import { expect, Locator } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import * as path from 'path';

/**
 * @pageIdentity WikipediaArticlePage
 * @urlPattern /wiki/Software_testing
 * @curated
 */
export class WikipediaArticlePage extends BasePage {
  static readonly urlPattern = /\/wiki\/Software_testing/;

  articleMain(): Locator {
    return this.page.locator('#content, #mw-content-text').first();
  }

  heading(): Locator {
    return this.page.locator('h1#firstHeading, h1.mw-first-heading').first();
  }

  viewHistoryLink(): Locator {
    return this.page
      .locator('#ca-history')
      .getByRole('link', { name: /View history/i })
      .or(this.page.getByRole('link', { name: /View history/i }))
      .first();
  }

  talkLink(): Locator {
    return this.page
      .locator('#ca-talk')
      .getByRole('link', { name: /^Talk$/i })
      .or(this.page.getByRole('link', { name: /^Talk$/i }))
      .first();
  }

  async assertOnArticlePage() {
    await this.assertUrl(WikipediaArticlePage.urlPattern);
    await expect(this.heading()).toContainText(/Software testing/i);
    await expect(
      this.articleMain().getByText(/From Wikipedia, the free encyclopedia/i).first()
    ).toBeVisible();
  }

  async assertTextVisible(text: string | RegExp) {
    await expect(this.articleMain().getByText(text, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
  }

  async assertSectionVisible(section: string) {
    // Wikipedia section titles live in .mw-headline (accessible name can include [edit]).
    const headline = this.page.locator('.mw-headline, .mw-heading').filter({
      hasText: new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    });
    const heading = this.articleMain().getByRole('heading', {
      name: new RegExp(section, 'i'),
    });
    const target = (await headline.count()) > 0 ? headline.first() : heading.first();
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeVisible({ timeout: 15_000 });
  }

  async assertArticleTabVisible() {
    await expect(
      this.page.locator('#ca-nstab-main').getByRole('link', { name: /Article/i }).first()
    ).toBeVisible();
  }

  async assertCategoriesVisible() {
    await expect(
      this.page.locator('#catlinks, .catlinks').getByText(/Categories/i).first()
    ).toBeVisible({ timeout: 15_000 });
  }

  async assertLastEditedVisible() {
    await expect(
      this.page.getByText(/This page was last edited/i).first()
    ).toBeVisible({ timeout: 15_000 });
  }

  async clickViewHistory() {
    await this.viewHistoryLink().click();
  }

  async clickTalk() {
    await this.talkLink().click();
  }

  async screenshotHeading(fileName: string) {
    const out = path.isAbsolute(fileName)
      ? fileName
      : path.join(process.cwd(), 'test-results', fileName);
    await this.heading().screenshot({ path: out });
  }
}
