import { expect, Locator, Page } from '@playwright/test';
import { BasePage } from '../../core/BasePage';

export class WikipediaArticlePage extends BasePage {
  static readonly urlPattern = /\/wiki\/Software_testing/;

  articleMain(): Locator {
    // Main article content region
    return this.page.locator('#content');
  }

  heading(): Locator {
    // Strict: h1#firstHeading
    return this.page.locator('h1#firstHeading');
  }

  viewHistoryLink(): Locator {
    // Strict: role=link, name=View history, in page actions
    return this.page.locator('#ca-history').getByRole('link', { name: 'View history' });
  }

  talkLink(): Locator {
    // Strict: role=link, name=Talk, in page actions
    return this.page.locator('#ca-talk').getByRole('link', { name: 'Talk' });
  }

  async assertOnArticlePage() {
    await this.assertUrl(WikipediaArticlePage.urlPattern);
    await expect(this.heading()).toHaveText('Software testing');
    await expect(this.articleMain().getByText('From Wikipedia, the free encyclopedia', { exact: false })).toBeVisible();
    // Keep this assert resilient — Wikipedia section chrome changes often.
    await expect(this.articleMain()).toBeVisible();
  }

  async clickViewHistory() {
    await this.viewHistoryLink().click();
  }

  async clickTalk() {
    await this.talkLink().click();
  }

  async screenshotHeading(filePath: string) {
    await this.heading().screenshot({ path: filePath });
  }


  subtitle(): Locator {
      return this.page.locator('.mw-subtitle');
    }

  viewHistoryTab(): Locator {
      // Scope to the page tabs navigation
      return this.page.locator('#ca-history a');
    }

  talkTab(): Locator {
      return this.page.locator('#ca-talk a');
    }

  async assertOnArticle(title: string) {
      await this.assertUrl(/\/wiki\//);
      await expect(this.heading()).toHaveText(title);
    }

  async assertTextVisible(text: string | RegExp) {
      // Scope to main article region to avoid strict mode violation
      await expect(this.articleMain().getByText(text, { exact: false }).first()).toBeVisible();
    }

  async assertSectionVisible(section: string) {
      // Wikipedia sections are h2/h3 with .mw-headline
      await expect(this.page.locator('.mw-headline', { hasText: section })).toBeVisible();
    }

  async clickTalkTab() {
      await this.talkTab().click();
    }
}
