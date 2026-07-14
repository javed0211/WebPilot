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

  public async assertVerifyPageUrlContainsSoftwareTesting(): Promise<void> {
    // assertion(strong): URL contains "Software_testing"
    await expect(this.page).toHaveURL(/Software_testing/);
  }

  public async clickViewHistory(): Promise<void> {
    // selector: confidence 0.94; signals: semantic, accessible-name, observed
    // fallbacks: getByRole('button', { name: 'View history' }) (0.94) | getByText('View history') (0.68) | getByText('Past revisions of this page [ctrl-option-h]') (0.68)
    await this.page.getByRole('link', { name: 'View history' }).click();
  }

  public async clickTalk(): Promise<void> {
    // selector: confidence 0.94; signals: semantic, accessible-name, observed
    // fallbacks: getByRole('button', { name: 'Talk' }) (0.94) | getByText('Talk') (0.68) | getByText('Discuss improvements to the content page [ctrl-option-t]') (0.68)
    await this.page.getByRole('link', { name: 'Talk' }).click();
  }
}
